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
