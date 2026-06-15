import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUsage, type OrgUsage } from "@/lib/usage";

function fmt(n: number): string {
  return n.toLocaleString("ro-RO");
}
function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function OrgRow({ org }: { org: OrgUsage }) {
  const [open, setOpen] = useState(false);
  const hasModels = org.byModel.length > 0;
  return (
    <>
      <TableRow className="hover:bg-gray-100">
        <TableCell className="px-4 py-3 font-medium text-foreground">
          <button
            type="button"
            className="inline-flex items-center gap-1"
            onClick={() => hasModels && setOpen((v) => !v)}
            aria-expanded={open}
          >
            {hasModels ? (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />) : <span className="inline-block w-4" />}
            {org.orgName}
          </button>
        </TableCell>
        <TableCell className="px-4 py-3 text-right text-foreground">{fmt(org.inputTokens)}</TableCell>
        <TableCell className="px-4 py-3 text-right text-foreground">{fmt(org.outputTokens)}</TableCell>
        <TableCell className="px-4 py-3 text-right font-medium text-foreground">{usd(org.costUsd)}</TableCell>
        <TableCell className="px-4 py-3 text-right text-foreground">{fmt(org.emailsRead)}</TableCell>
        <TableCell className="px-4 py-3 text-right text-foreground">{fmt(org.emailsWritten)}</TableCell>
        <TableCell className="px-4 py-3 text-right text-success">{fmt(org.appointments)}</TableCell>
        <TableCell className="px-4 py-3 text-right text-muted-foreground">{fmt(org.junk)}</TableCell>
      </TableRow>
      {open
        ? org.byModel.map((m) => (
            <TableRow key={`${org.orgId}-${m.provider}-${m.model}`} className="bg-gray-50/60">
              <TableCell className="px-4 py-2 pl-10 text-xs text-muted-foreground">
                {m.provider}/{m.model} · {fmt(m.calls)} apeluri
              </TableCell>
              <TableCell className="px-4 py-2 text-right text-xs text-muted-foreground">{fmt(m.inputTokens)}</TableCell>
              <TableCell className="px-4 py-2 text-right text-xs text-muted-foreground">{fmt(m.outputTokens)}</TableCell>
              <TableCell className="px-4 py-2 text-right text-xs text-muted-foreground">{usd(m.costUsd)}</TableCell>
              <TableCell colSpan={4} />
            </TableRow>
          ))
        : null}
    </>
  );
}

export function UsageSection() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = {
    from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
  };
  const { data, isLoading, isError } = useUsage(range);

  return (
    <section className="mb-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Utilizare &amp; costuri</h2>
        <div className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">
            De la
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </label>
          <label className="text-xs text-muted-foreground">
            Până la
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </label>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă…</p>
      ) : isError || !data ? (
        <p className="text-sm text-error">Nu s-au putut încărca datele de utilizare.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <TotalCard label="Cost estimat" value={usd(data.totals.costUsd)} />
            <TotalCard label="Tokeni intrare" value={fmt(data.totals.inputTokens)} />
            <TotalCard label="Tokeni ieșire" value={fmt(data.totals.outputTokens)} />
            <TotalCard label="Emailuri citite" value={fmt(data.totals.emailsRead)} />
            <TotalCard label="Emailuri trimise" value={fmt(data.totals.emailsWritten)} />
            <TotalCard label="Programări" value={fmt(data.totals.appointments)} />
            <TotalCard label="Junk" value={fmt(data.totals.junk)} />
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 hover:bg-gray-50">
                  <TableHead className="px-4 text-muted-foreground">Organizație</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Tok. in</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Tok. out</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Cost</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Emailuri citite</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Emailuri trimise</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Programări</TableHead>
                  <TableHead className="px-4 text-right text-muted-foreground">Junk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orgs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Nicio utilizare înregistrată.</TableCell></TableRow>
                ) : (
                  data.orgs.map((o) => <OrgRow key={o.orgId} org={o} />)
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
