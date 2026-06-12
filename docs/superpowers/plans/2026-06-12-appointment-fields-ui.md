# Appointment Field Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org admins add/remove/edit the per-org appointment fields from a new "Câmpuri programări" section on the Settings page.

**Architecture:** Frontend-only. Extend `lib/appointments.ts` with a fields query/mutation and a pure `deriveFieldKey` helper; new `AppointmentFieldsSection` component (local draft state, single full-replace save against the existing `PUT /appointment-fields`); rendered admin-only in `SettingsPage`.

**Tech Stack:** React, TanStack Query, shadcn Table/Input/Button/Label, vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-appointment-fields-ui-design.md`

**Conventions:** run frontend tests with `cd frontend && npm test`; typecheck+bundle with `npm run build`. UI copy in Romanian.

---

## File structure

```
frontend/src/lib/appointments.ts                                   (modify: types, hooks, deriveFieldKey)
frontend/src/lib/appointments.test.ts                              (new)
frontend/src/components/settings/appointment-fields-section.tsx    (new)
frontend/src/pages/settings.tsx                                    (modify: render section)
```

---

### Task 1: Data layer + deriveFieldKey

**Files:**
- Modify: `frontend/src/lib/appointments.ts`
- Test: `frontend/src/lib/appointments.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "vitest";
import { deriveFieldKey } from "./appointments";

describe("deriveFieldKey", () => {
  test("camelCases and strips diacritics", () => {
    expect(deriveFieldKey("Data dorită", [])).toBe("dataDorita");
    expect(deriveFieldKey("Serviciu dorit", [])).toBe("serviciuDorit");
  });

  test("drops non-alphanumerics", () => {
    expect(deriveFieldKey("Nr. înmatriculare (auto)", [])).toBe("nrInmatriculareAuto");
  });

  test("prefixes f when starting with a digit", () => {
    expect(deriveFieldKey("4x4", [])).toBe("f4x4");
  });

  test("appends counter on collision", () => {
    expect(deriveFieldKey("Telefon", ["telefon"])).toBe("telefon2");
    expect(deriveFieldKey("Telefon", ["telefon", "telefon2"])).toBe("telefon3");
  });

  test("falls back to camp for empty label", () => {
    expect(deriveFieldKey("", [])).toBe("camp");
    expect(deriveFieldKey("!!!", ["camp"])).toBe("camp2");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd frontend && npm test -- appointments`
Expected: FAIL — `deriveFieldKey` not exported.

- [ ] **Step 3: Implement** (append to `lib/appointments.ts`; add `useMutation, useQuery, useQueryClient` to the react-query import)

```typescript
export interface AppointmentFieldConfig {
  key: string;
  label: string;
  description: string;
  required: boolean;
  sortOrder: number;
}

async function fetchAppointmentFields(): Promise<AppointmentFieldConfig[]> {
  const res = await apiFetch("/appointment-fields");
  if (!res.ok) throw new Error("Încărcarea câmpurilor a eșuat");
  const data = (await res.json()) as { fields: AppointmentFieldConfig[] };
  return data.fields;
}

export function useAppointmentFields() {
  return useQuery({ queryKey: ["appointment-fields"], queryFn: fetchAppointmentFields });
}

async function saveAppointmentFields(fields: AppointmentFieldConfig[]): Promise<AppointmentFieldConfig[]> {
  const res = await apiFetch("/appointment-fields", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("Salvarea câmpurilor a eșuat");
  const data = (await res.json()) as { fields: AppointmentFieldConfig[] };
  return data.fields;
}

export function useSaveAppointmentFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveAppointmentFields,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointment-fields"] });
      // Listing's missingLabels derive from the config.
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}

/** Backend key contract: /^[a-zA-Z][a-zA-Z0-9]*$/ and unique per org. */
export function deriveFieldKey(label: string, existingKeys: string[]): string {
  const words = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  let key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  if (key === "") key = "camp";
  if (/^[0-9]/.test(key)) key = `f${key}`;
  if (!existingKeys.includes(key)) return key;
  let n = 2;
  while (existingKeys.includes(`${key}${n}`)) n += 1;
  return `${key}${n}`;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npm test -- appointments`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/appointments.ts frontend/src/lib/appointments.test.ts
git commit -m "feat: appointment field config data layer + key derivation"
```

---

### Task 2: AppointmentFieldsSection component

**Files:**
- Create: `frontend/src/components/settings/appointment-fields-section.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAppointmentFields,
  useSaveAppointmentFields,
  deriveFieldKey,
  type AppointmentFieldConfig,
} from "@/lib/appointments";

/** Draft row: key is empty until first save for newly added fields. */
interface DraftField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

export function AppointmentFieldsSection() {
  const { data: fields, isLoading } = useAppointmentFields();
  const save = useSaveAppointmentFields();
  const [draft, setDraft] = useState<DraftField[]>([]);
  const [dirty, setDirty] = useState(false);

  // Seed (and reseed after save) from the server while the form is pristine.
  useEffect(() => {
    if (fields && !dirty) {
      setDraft(fields.map(({ key, label, description, required }) => ({ key, label, description, required })));
    }
  }, [fields, dirty]);

  function update(index: number, patch: Partial<DraftField>) {
    setDraft((d) => d.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
  }

  function remove(index: number) {
    setDraft((d) => d.filter((_, i) => i !== index));
    setDirty(true);
  }

  function add() {
    setDraft((d) => [...d, { key: "", label: "", description: "", required: true }]);
    setDirty(true);
  }

  function submit() {
    const existingKeys = draft.map((f) => f.key).filter(Boolean);
    const payload: AppointmentFieldConfig[] = draft.map((f, i) => {
      const key = f.key || deriveFieldKey(f.label, existingKeys);
      if (!f.key) existingKeys.push(key);
      return { ...f, key, sortOrder: i };
    });
    save.mutate(payload, { onSuccess: () => setDirty(false) });
  }

  const valid = draft.length > 0 && draft.every((f) => f.label.trim() !== "");

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Câmpuri programări</h2>
          <p className="text-sm text-muted-foreground">
            Informațiile cerute clienților care solicită o programare pe email
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Adaugă câmp
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="px-4 text-muted-foreground">Denumire</TableHead>
              <TableHead className="px-4 text-muted-foreground">Descriere (ghidează extragerea)</TableHead>
              <TableHead className="px-4 text-muted-foreground">Obligatoriu</TableHead>
              <TableHead className="px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Se încarcă...
                </TableCell>
              </TableRow>
            ) : (
              draft.map((f, i) => (
                <TableRow key={f.key || `new-${i}`} className="hover:bg-gray-50">
                  <TableCell className="px-4 py-2">
                    <Input
                      value={f.label}
                      placeholder="ex: Telefon"
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-2">
                    <Input
                      value={f.description}
                      placeholder="ex: Număr de telefon de contact"
                      onChange={(e) => update(i, { description: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => update(i, { required: e.target.checked })}
                      aria-label={`Obligatoriu: ${f.label || "câmp nou"}`}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={draft.length === 1}
                      onClick={() => remove(i)}
                      title={draft.length === 1 ? "Cel puțin un câmp este necesar" : "Șterge câmpul"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button type="button" disabled={!dirty || !valid || save.isPending} onClick={submit}>
          {save.isPending ? "Se salvează..." : "Salvează"}
        </Button>
        {save.isError && <p className="text-sm text-error">Salvarea câmpurilor a eșuat</p>}
        {save.isSuccess && !dirty && <p className="text-sm text-success">Salvat</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run build`
Expected: clean (component not yet rendered; unused-export warnings are not errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/settings/appointment-fields-section.tsx
git commit -m "feat: appointment fields editor section (add/remove/edit, full-replace save)"
```

---

### Task 3: Render in Settings + verify

**Files:**
- Modify: `frontend/src/pages/settings.tsx`

- [ ] **Step 1: Render admin-only**

Add import:

```tsx
import { AppointmentFieldsSection } from "@/components/settings/appointment-fields-section";
```

In `SettingsPage`, after `{isAdmin && <UsersSection />}` add:

```tsx
      {isAdmin && <AppointmentFieldsSection />}
```

- [ ] **Step 2: Full verification**

Run: `cd frontend && npm test && npm run build`
Expected: all tests pass (existing 19 + new 5), build clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/settings.tsx
git commit -m "feat: settings page hosts appointment fields editor (admin-only)"
```

---

## Out of scope

Reordering UI, key editing, non-admin read-only view, backend changes.
