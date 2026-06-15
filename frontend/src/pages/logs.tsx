import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizations } from "@/lib/organizations";
import { useLogs, type LogFilters, type LogLevel, type LogRow, type LogSource } from "@/lib/logs";

const selectClass =
  "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-gray-100 text-gray-600",
};

function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>
      {level}
    </span>
  );
}

function LogDetailDialog({ log, orgName, onClose }: { log: LogRow | null; orgName: string | null; onClose: () => void }) {
  return (
    <Dialog open={log !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalii log</DialogTitle>
        </DialogHeader>
        {log ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{new Date(log.createdAt).toLocaleString("ro-RO")}</span>
              <span>nivel: {log.level}</span>
              <span>sursă: {log.source}</span>
              {orgName ? <span>organizație: {orgName}</span> : null}
              {log.requestId ? <span>requestId: {log.requestId}</span> : null}
              {log.url ? <span>url: {log.url}</span> : null}
              {log.userId ? <span>user: {log.userId}</span> : null}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Mesaj</p>
              <p className="whitespace-pre-wrap break-words text-foreground">{log.message}</p>
            </div>

            {log.stack ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Stack</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-foreground">{log.stack}</pre>
              </div>
            ) : null}

            {log.context != null ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Context</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-foreground">
                  {JSON.stringify(log.context, null, 2)}
                </pre>
              </div>
            ) : null}

            {log.userAgent ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">User agent</p>
                <p className="break-words text-xs text-muted-foreground">{log.userAgent}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function LogsTab() {
  const { data: orgs = [] } = useOrganizations();
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);

  const [filters, setFilters] = useState<LogFilters>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogRow | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useLogs(filters);
  const rows = data?.pages.flatMap((p) => p.logs) ?? [];

  function setFilter<K extends keyof LogFilters>(key: K, value: LogFilters[K]) {
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setFilter("q", search.trim() || undefined);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Nivel"
          className={selectClass}
          value={filters.level ?? ""}
          onChange={(e) => setFilter("level", (e.target.value || undefined) as LogLevel | undefined)}
        >
          <option value="">Toate nivelurile</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
        </select>

        <select
          aria-label="Sursă"
          className={selectClass}
          value={filters.source ?? ""}
          onChange={(e) => setFilter("source", (e.target.value || undefined) as LogSource | undefined)}
        >
          <option value="">Toate sursele</option>
          <option value="backend">backend</option>
          <option value="frontend">frontend</option>
        </select>

        <select
          aria-label="Organizație"
          className={selectClass}
          value={filters.orgId ?? ""}
          onChange={(e) => setFilter("orgId", e.target.value || undefined)}
        >
          <option value="">Toate organizațiile</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>

        <Input
          className="w-56"
          placeholder="Caută în mesaj…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" variant="outline">Caută</Button>
        <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          Reîmprospătează
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="px-4 text-muted-foreground">Timp</TableHead>
              <TableHead className="px-4 text-muted-foreground">Nivel</TableHead>
              <TableHead className="px-4 text-muted-foreground">Sursă</TableHead>
              <TableHead className="px-4 text-muted-foreground">Organizație</TableHead>
              <TableHead className="px-4 text-muted-foreground">Mesaj</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Se încarcă...</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={5} className="px-4 py-6 text-center text-error">Nu s-au putut încărca logurile.</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Niciun log.</TableCell></TableRow>
            ) : (
              rows.map((log) => (
                <TableRow key={log.id} className="cursor-pointer hover:bg-gray-100" onClick={() => setSelected(log)}>
                  <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground">{new Date(log.createdAt).toLocaleString("ro-RO")}</TableCell>
                  <TableCell className="px-4 py-3"><LevelBadge level={log.level} /></TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{log.source}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{log.orgId ? orgName.get(log.orgId) ?? log.orgId : "—"}</TableCell>
                  <TableCell className="max-w-md truncate px-4 py-3 text-foreground">{log.message}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Se încarcă…" : "Încarcă mai multe"}
          </Button>
        </div>
      ) : null}

      <LogDetailDialog
        log={selected}
        orgName={selected?.orgId ? orgName.get(selected.orgId) ?? selected.orgId : null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
