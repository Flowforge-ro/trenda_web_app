import { useTimeSaved, useOverview, useVendorScorecard } from "../lib/analytics";

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "error" | "warning" }) {
  const valueColor = tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function AnalyticsPage() {
  const { data: overview } = useOverview();
  const { data: ts } = useTimeSaved();
  const { data: vendors } = useVendorScorecard();
  const topVendor = vendors && vendors.length ? vendors[0] : null;

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analize</h1>
        <p className="mt-1 text-sm text-muted-foreground">Starea comenzilor și a furnizorilor</p>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Stare comenzi</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card label="Comenzi deschise" value={overview ? String(overview.openOrders) : "—"} />
          <Card label="Livrări în 7 zile" value={overview ? String(overview.dueSoon) : "—"} tone="warning" />
          <Card label="Întârziate" value={overview ? String(overview.overdue) : "—"} tone={overview && overview.overdue > 0 ? "error" : undefined} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Activitate automatizată</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card label="Emailuri trimise" value={ts ? String(ts.emailsSent) : "—"} />
          <Card label="Răspunsuri citite automat" value={ts ? String(ts.repliesParsed) : "—"} />
          <Card label="Timp economisit" value={ts ? `${ts.hoursSaved.toFixed(1)} h` : "—"} sub={ts ? `≈ ${ts.valueSavedRon.toFixed(0)} RON` : undefined} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Furnizori</h2>
        {topVendor && topVendor.orderShare >= 0.4 ? (
          <p className="mb-3 text-sm text-warning">
            Dependență ridicată: {topVendor.name ?? topVendor.vendorEmail} acoperă {pct(topVendor.orderShare)} din comenzi.
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">Performanța și ponderea fiecărui furnizor.</p>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground">
            <th className="py-2">Furnizor</th><th>Comenzi</th><th>Pondere</th><th>Răspuns mediu</th><th>La timp</th><th>De verificat</th><th>Eșuate</th>
          </tr></thead>
          <tbody>
            {(vendors ?? []).map((v) => (
              <tr key={v.vendorEmail} className="border-t border-border">
                <td className="py-2">
                  <div className="text-foreground">{v.name ?? v.vendorEmail}</div>
                  {v.name && <div className="text-xs text-muted-foreground">{v.vendorEmail}</div>}
                </td>
                <td>{v.orders}</td>
                <td>{pct(v.orderShare)}</td>
                <td>{v.avgResponseHours != null ? `${v.avgResponseHours.toFixed(1)}h` : "—"}</td>
                <td>{v.onTimeRate != null ? pct(v.onTimeRate) : "—"}</td>
                <td>{pct(v.needsReviewRate)}</td>
                <td>{pct(v.bounceRate)}</td>
              </tr>
            ))}
            {vendors && vendors.length === 0 && (
              <tr className="border-t border-border"><td colSpan={7} className="py-3 text-muted-foreground">Niciun furnizor încă.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
