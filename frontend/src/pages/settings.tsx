import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth, useChangePassword } from "@/lib/auth";
import { useMailboxes, useDisconnectMailbox, connectMailboxUrl, type MailboxType } from "@/lib/mailboxes";
import { useUsers, useCreateUser, useResetUserPassword, type OrgUser } from "@/lib/users";
import { logAction } from "@/lib/logger";
import { AppointmentFieldsSection } from "@/components/settings/appointment-fields-section";

function MailboxesSection({ isAdmin }: { isAdmin: boolean }) {
  const { data: mailboxes = [], isLoading } = useMailboxes();
  const disconnect = useDisconnectMailbox();
  const [type, setType] = useState<MailboxType>("vendor_facing");

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground">Cutii poștale</h2>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MailboxType)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="vendor_facing">Furnizori</option>
              <option value="client_facing">Clienți</option>
            </select>
            <Button onClick={() => { logAction("mailbox.connect.start", { type }); window.location.href = connectMailboxUrl(type); }}>
              <Plus />
              Conectează
            </Button>
          </div>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : mailboxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nicio cutie poștală conectată.</p>
      ) : (
        <ul className="divide-y rounded-lg border border-gray-200">
          {mailboxes.map((m) => (
            <li key={m.id} className="flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground break-all">{m.email}</p>
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {m.type === "vendor_facing" ? "Furnizori" : "Clienți"}
                </span>
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disconnect.isPending} onClick={() => disconnect.mutate(m.id)} title="Deconectează">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddUserDialog() {
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; name: string; role: "admin" | "member" }>({
    email: "", password: "", name: "", role: "member",
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { email: form.email, password: form.password, name: form.name || undefined, role: form.role },
      { onSuccess: () => { setForm({ email: "", password: "", name: "", role: "member" }); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Utilizator nou
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader><DialogTitle>Utilizator nou</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-password">Parolă</Label>
              <Input id="u-password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-name">Nume (opțional)</Label>
              <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="u-role">Rol</Label>
              <select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "member" })}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
                <option value="member">Membru</option>
                <option value="admin">Administrator</option>
              </select>
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

function ResetPasswordDialog({ user }: { user: OrgUser }) {
  const reset = useResetUserPassword();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    reset.mutate(
      { id: user.id, password },
      { onSuccess: () => { setPassword(""); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Resetează parola</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Resetează parola — {user.email}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor={`reset-pw-${user.id}`}>Parolă nouă</Label>
            <Input
              id={`reset-pw-${user.id}`}
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Utilizatorul va fi deconectat de pe toate dispozitivele.</p>
          </div>
          {reset.isError && <p className="text-sm text-error">Resetarea parolei a eșuat.</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={reset.isPending}>{reset.isPending ? "Se salvează..." : "Salvează"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersSection() {
  const { data: users = [], isLoading } = useUsers(true);
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground">Utilizatori</h2>
        <AddUserDialog />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : (
        <ul className="divide-y rounded-lg border border-gray-200">
          {users.map((u) => (
            <li key={u.id} className="flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground break-all">{u.name ?? u.email}</p>
                <p className="text-xs text-muted-foreground break-all">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {u.role === "admin" ? "Administrator" : "Membru"}
                </span>
                <ResetPasswordDialog user={u} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangePasswordSection() {
  const change = useChangePassword();
  const [form, setForm] = useState({ current: "", next: "" });
  const [saved, setSaved] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    change.mutate(
      { currentPassword: form.current, newPassword: form.next },
      { onSuccess: () => { setForm({ current: "", next: "" }); setSaved(true); } }
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Schimbă parola</h2>
      <form onSubmit={submit} className="max-w-sm space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="grid gap-2">
          <Label htmlFor="pw-current">Parola actuală</Label>
          <Input id="pw-current" type="password" required value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pw-new">Parola nouă</Label>
          <Input id="pw-new" type="password" required minLength={8} value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </div>
        {change.isError && (
          <p className="text-sm text-error">{change.error instanceof Error ? change.error.message : "Schimbarea parolei a eșuat"}</p>
        )}
        {saved && <p className="text-sm text-success">Parola a fost schimbată.</p>}
        <Button type="submit" disabled={change.isPending}>{change.isPending ? "Se salvează..." : "Schimbă parola"}</Button>
      </form>
    </section>
  );
}

export function SettingsPage() {
  const { data: user } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <div className="space-y-8 p-4 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Setări</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cutii poștale și utilizatori</p>
      </header>
      <MailboxesSection isAdmin={isAdmin} />
      {isAdmin && <UsersSection />}
      {isAdmin && <AppointmentFieldsSection />}
      <ChangePasswordSection />
    </div>
  );
}
