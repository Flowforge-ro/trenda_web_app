import { useState } from "react";
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

/** Draft row: key stays empty for newly added fields until save derives one. */
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
  // A refetch hands back a new `fields` reference, so syncing on identity change
  // during render (React's recommended alternative to an effect) reseeds the draft.
  const [seededFrom, setSeededFrom] = useState<typeof fields>(undefined);
  if (fields && fields !== seededFrom && !dirty) {
    setSeededFrom(fields);
    setDraft(fields.map(({ key, label, description, required }) => ({ key, label, description, required })));
  }

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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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

      {/* Desktop: dense table. Mobile: stacked cards (below) so inputs aren't clipped. */}
      <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white md:block">
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

      {/* Mobile: one card per field, inputs full width so the whole text shows. */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă...</p>
        ) : (
          draft.map((f, i) => (
            <div key={f.key || `new-${i}`} className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor={`label-${i}`}>Denumire</label>
                <Input
                  id={`label-${i}`}
                  value={f.label}
                  placeholder="ex: Telefon"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor={`desc-${i}`}>Descriere (ghidează extragerea)</label>
                <Input
                  id={`desc-${i}`}
                  value={f.description}
                  placeholder="ex: Număr de telefon de contact"
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                    aria-label={`Obligatoriu: ${f.label || "câmp nou"}`}
                  />
                  Obligatoriu
                </label>
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
              </div>
            </div>
          ))
        )}
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
