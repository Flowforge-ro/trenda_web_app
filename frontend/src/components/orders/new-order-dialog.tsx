import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface NewOrderForm {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

const emptyForm: NewOrderForm = {
  emailFurnizor: "",
  serieSasiu: "",
  piesa: "",
};

export function NewOrderDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewOrderForm>(emptyForm);

  function update<K extends keyof NewOrderForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // TODO: wire to backend once the create-order endpoint exists.
    console.log("Comandă nouă:", form);
    setForm(emptyForm);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="hover:shadow-lg" />}>
        <Plus />
        Comandă nouă
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Comandă nouă</DialogTitle>
            <DialogDescription>
              Completează detaliile comenzii de piese.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="emailFurnizor">Email furnizor</Label>
              <Input
                id="emailFurnizor"
                type="email"
                required
                placeholder="furnizor@exemplu.ro"
                value={form.emailFurnizor}
                onChange={(e) => update("emailFurnizor", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="serieSasiu">Serie sasiu</Label>
              <Input
                id="serieSasiu"
                required
                placeholder="WVWZZZ1KZAW000001"
                value={form.serieSasiu}
                onChange={(e) => update("serieSasiu", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="piesa">Piesa</Label>
              <Input
                id="piesa"
                required
                placeholder="Filtru ulei"
                value={form.piesa}
                onChange={(e) => update("piesa", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Anulează
            </DialogClose>
            <Button type="submit">Trimite</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
