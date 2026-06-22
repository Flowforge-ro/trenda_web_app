import { useState, type FormEvent } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useVendors, useCreateVendor, type Vendor } from "@/lib/vendors";

interface VendorSelectProps {
  value: string; // selected vendorId
  selectedLabel?: string; // "Name (email)" of the current selection, for display
  onSelect: (vendor: Vendor) => void;
}

/**
 * Searchable vendor picker with an inline "create vendor" form. Built from
 * plain primitives (no popover dep): a trigger input that filters the org's
 * vendors, plus a footer action that swaps the list for a small create form.
 */
export function VendorSelect({ value, selectedLabel, onSelect }: VendorSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data: vendors = [], isLoading } = useVendors(search.trim() || undefined);

  function pick(v: Vendor) {
    onSelect(v);
    setOpen(false);
    setSearch("");
    setCreating(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={open}
      >
        <span className={cn(value ? "text-foreground" : "text-muted-foreground")}>
          {selectedLabel || "Alege un furnizor"}
        </span>
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
          {creating ? (
            <CreateVendorForm
              initialEmail={search.includes("@") ? search.trim() : ""}
              onCancel={() => setCreating(false)}
              onCreated={pick}
            />
          ) : (
            <>
              <div className="border-b border-border p-2">
                <Input
                  autoFocus
                  placeholder="Caută furnizor..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <ul className="max-h-56 overflow-y-auto py-1">
                {isLoading ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Se încarcă...</li>
                ) : vendors.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Niciun furnizor găsit</li>
                ) : (
                  vendors.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => pick(v)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="truncate">
                          <span className="text-foreground">{v.name}</span>{" "}
                          <span className="text-muted-foreground">{v.email}</span>
                        </span>
                        {v.id === value && <Check className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="border-t border-border p-1">
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Adaugă furnizor
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CreateVendorForm({
  initialEmail,
  onCancel,
  onCreated,
}: {
  initialEmail: string;
  onCancel: () => void;
  onCreated: (v: Vendor) => void;
}) {
  const create = useCreateVendor();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined },
      { onSuccess: onCreated }
    );
  }

  return (
    // Nested inside the order form: submit/keystrokes must not bubble up and
    // trigger the parent form's submit handler.
    <div className="grid gap-2 p-3" onKeyDown={(e) => e.stopPropagation()}>
      <div className="grid gap-1">
        <Label htmlFor="vendor-name">Nume</Label>
        <Input id="vendor-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Furnizor SRL" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vendor-email">Email</Label>
        <Input id="vendor-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="furnizor@exemplu.ro" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vendor-phone">Telefon (opțional)</Label>
        <Input id="vendor-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
      </div>
      {create.isError && <p className="text-sm text-error">Crearea furnizorului a eșuat.</p>}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Anulează</Button>
        <Button
          type="button"
          size="sm"
          disabled={create.isPending || !name.trim() || !email.trim()}
          onClick={submit}
        >
          {create.isPending ? "Se salvează..." : "Salvează"}
        </Button>
      </div>
    </div>
  );
}
