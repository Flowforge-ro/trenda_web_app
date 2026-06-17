import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateOrder } from "@/lib/orders";
import { useMailboxes, type Mailbox } from "@/lib/mailboxes";

interface NewOrderForm {
  vendorEmail: string;
  chassisSeries: string;
  partCode: string;
  mailboxId: string;
  registrationNumber: string;
}

const emptyForm: NewOrderForm = { vendorEmail: "", chassisSeries: "", partCode: "", mailboxId: "", registrationNumber: "" };

export function NewOrderDialog() {
  const [open, setOpen] = useState(false);
  const { data: mailboxes = [] } = useMailboxes();
  const vendorMailboxes = mailboxes.filter((m) => m.type === "vendor_facing");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="hover:shadow-lg" />}>
        <Plus />
        Comandă nouă
      </DialogTrigger>
      <DialogContent>
        {/* Mounted only while open, so each open starts from a fresh form
            (default mailbox seeded below) and closing discards edits. */}
        <NewOrderForm vendorMailboxes={vendorMailboxes} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewOrderForm({ vendorMailboxes, onClose }: { vendorMailboxes: Mailbox[]; onClose: () => void }) {
  const createOrder = useCreateOrder();
  // Default to the only vendor mailbox; seeded at mount (dialog open).
  const [form, setForm] = useState<NewOrderForm>(() => ({
    ...emptyForm,
    mailboxId: vendorMailboxes.length === 1 ? vendorMailboxes[0].id : "",
  }));

  function update<K extends keyof NewOrderForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createOrder.mutate(form, {
      onSuccess: ({ emailSent }) => {
        if (!emailSent) alert("Comanda a fost salvată, dar emailul nu a putut fi trimis.");
        onClose();
      },
    });
  }

  return (
    <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Comandă nouă</DialogTitle>
            <DialogDescription>Completează detaliile comenzii de piese.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="mailboxId">Cutie poștală (furnizor)</Label>
              {vendorMailboxes.length === 0 ? (
                <p className="text-sm text-error">
                  Nicio cutie poștală pentru furnizori. Conectează una în Setări.
                </p>
              ) : (
                <select
                  id="mailboxId"
                  required
                  value={form.mailboxId}
                  onChange={(e) => update("mailboxId", e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="" disabled>Alege o cutie poștală</option>
                  {vendorMailboxes.map((m) => (
                    <option key={m.id} value={m.id}>{m.email}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vendorEmail">Email furnizor</Label>
              <Input id="vendorEmail" type="email" required placeholder="furnizor@exemplu.ro" value={form.vendorEmail} onChange={(e) => update("vendorEmail", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="chassisSeries">Serie sasiu</Label>
              <Input id="chassisSeries" required placeholder="WVWZZZ1KZAW000001" value={form.chassisSeries} onChange={(e) => update("chassisSeries", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrationNumber">Număr înmatriculare</Label>
              <Input id="registrationNumber" required placeholder="B 123 ABC" value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partCode">Cod piesă</Label>
              <Input id="partCode" required placeholder="OEM 06A115561B" value={form.partCode} onChange={(e) => update("partCode", e.target.value)} />
            </div>
          </div>

          {createOrder.isError && <p className="text-sm text-error">Crearea comenzii a eșuat. Încearcă din nou.</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={createOrder.isPending || !form.mailboxId}>
              {createOrder.isPending ? "Se trimite..." : "Trimite"}
            </Button>
          </DialogFooter>
        </form>
  );
}
