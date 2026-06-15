import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizations, useCreateOrganization, useSetOrganizationSuspended, type Organization } from "@/lib/organizations";

function CreateOrgDialog() {
  const create = useCreateOrganization();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", adminName: "" });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: form.name, admin: { email: form.email, password: form.password, name: form.adminName || undefined } },
      { onSuccess: () => { setForm({ name: "", email: "", password: "", adminName: "" }); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="hover:shadow-lg" />}>
        <Plus />
        Organizație nouă
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Organizație nouă</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="org-name">Nume organizație</Label>
              <Input id="org-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-email">Email administrator</Label>
              <Input id="admin-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-password">Parolă administrator</Label>
              <Input id="admin-password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-name">Nume administrator (opțional)</Label>
              <Input id="admin-name" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
            </div>
          </div>
          {create.isError && <p className="text-sm text-error">Crearea a eșuat (email deja folosit?).</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Se creează..." : "Creează"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SuspendButton({ org }: { org: Organization }) {
  const setSuspended = useSetOrganizationSuspended();
  const suspended = org.suspendedAt !== null;

  function toggle() {
    if (!suspended && !window.confirm(`Suspendați organizația „${org.name}”? Utilizatorii ei vor pierde accesul imediat.`)) return;
    setSuspended.mutate({ id: org.id, suspended: !suspended });
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} disabled={setSuspended.isPending}>
      {suspended ? "Reactivează" : "Suspendă"}
    </Button>
  );
}

export function OrgsTab() {
  const { data: orgs = [], isLoading } = useOrganizations();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateOrgDialog />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="px-4 text-muted-foreground">Nume</TableHead>
              <TableHead className="px-4 text-muted-foreground">Utilizatori</TableHead>
              <TableHead className="px-4 text-muted-foreground">Cutii poștale</TableHead>
              <TableHead className="px-4 text-muted-foreground">Creată</TableHead>
              <TableHead className="px-4 text-muted-foreground">Stare</TableHead>
              <TableHead className="px-4 text-muted-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Se încarcă...</TableCell></TableRow>
            ) : (
              orgs.map((o) => (
                <TableRow key={o.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">{o.name}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.userCount}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.mailboxCount}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("ro-RO")}</TableCell>
                  <TableCell className="px-4 py-3">
                    {o.suspendedAt ? (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Suspendată</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Activă</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <SuspendButton org={o} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
