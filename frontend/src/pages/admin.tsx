import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth, useChangePassword } from "@/lib/auth";
import { apiFetch } from "@/lib/http";
import { logAction } from "@/lib/logger";
import { OrgsTab } from "./admin-orgs";
import { LogsTab } from "./logs";
import { FlaggedOrdersTab } from "./admin-flagged";

async function logout() {
  logAction("logout");
  await apiFetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

function ChangePasswordDialog() {
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "" });

  function submit(e: FormEvent) {
    e.preventDefault();
    change.mutate(
      { currentPassword: form.current, newPassword: form.next },
      { onSuccess: () => { setForm({ current: "", next: "" }); setOpen(false); } }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>Schimbă parola</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Schimbă parola</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sa-pw-current">Parola actuală</Label>
              <Input id="sa-pw-current" type="password" required value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sa-pw-new">Parola nouă</Label>
              <Input id="sa-pw-new" type="password" required minLength={8} value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })} />
            </div>
          </div>
          {change.isError && (
            <p className="text-sm text-error">{change.error instanceof Error ? change.error.message : "Schimbarea parolei a eșuat"}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
            <Button type="submit" disabled={change.isPending}>{change.isPending ? "Se salvează..." : "Salvează"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Tab = "orgs" | "logs" | "flagged";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function SuperadminPanel() {
  const { data: user } = useAuth();
  const [tab, setTab] = useState<Tab>("orgs");

  return (
    <div className="min-h-screen bg-white p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Panou Superadmin</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <div className="flex gap-2">
          <ChangePasswordDialog />
          <Button variant="outline" onClick={logout}>Deconectare</Button>
        </div>
      </header>

      <nav className="mb-6 flex gap-6 border-b border-gray-200">
        <TabButton active={tab === "orgs"} onClick={() => setTab("orgs")}>Organizații</TabButton>
        <TabButton active={tab === "flagged"} onClick={() => setTab("flagged")}>Comenzi semnalate</TabButton>
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>Loguri</TabButton>
      </nav>

      {tab === "orgs" ? <OrgsTab /> : tab === "flagged" ? <FlaggedOrdersTab /> : <LogsTab />}
    </div>
  );
}
