import { useTimeSaved } from "../lib/analytics";

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function AnalyticsPage() {
  const { data } = useTimeSaved();
  const ts = data;
  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analize</h1>
        <p className="mt-1 text-sm text-muted-foreground">Valoarea adusă de Trenda</p>
      </header>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Timp economisit</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Ore economisite" value={ts ? ts.hoursSaved.toFixed(1) : "—"} />
          <Card label="Valoare (RON)" value={ts ? ts.valueSavedRon.toFixed(0) : "—"} />
          <Card label="Cost AI (USD)" value={ts ? ts.costUsd.toFixed(2) : "—"} />
          <Card label="ROI" value={ts && ts.roi != null ? `${ts.roi.toFixed(1)}×` : "—"} />
        </div>
      </section>
    </div>
  );
}
