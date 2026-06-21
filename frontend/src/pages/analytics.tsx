import { useTimeSaved, useDeliveryBoard, useVendorScorecard } from "../lib/analytics";

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
  const { data: board } = useDeliveryBoard();
  const { data: vendors } = useVendorScorecard();
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ro-RO") : "—");
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
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Livrări</h2>
        {board?.overdue.length ? (
          <p className="mb-2 text-sm text-error">{board.overdue.length} comenzi întârziate</p>
        ) : null}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground">
            <th className="py-2">Piesa</th><th>Furnizor</th><th>Comanda</th><th>Livrare</th><th>Stare</th>
          </tr></thead>
          <tbody>
            {[...(board?.overdue ?? []), ...(board?.upcoming ?? [])].map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="py-2">{o.partCode}</td>
                <td>{o.vendorEmail}</td>
                <td>{o.orderNumber ?? "—"}</td>
                <td>{fmtDate(o.deliveryEarliest)}</td>
                <td>{board?.overdue.some((x) => x.id === o.id) ? <span className="text-error">întârziat</span> : "în termen"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Furnizori</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground">
            <th className="py-2">Furnizor</th><th>Comenzi</th><th>Răspuns mediu</th><th>La timp</th><th>De verificat</th><th>Eșuate</th>
          </tr></thead>
          <tbody>
            {(vendors ?? []).map((v) => (
              <tr key={v.vendorEmail} className="border-t border-border">
                <td className="py-2">{v.vendorEmail}</td>
                <td>{v.orders}</td>
                <td>{v.avgResponseHours != null ? `${v.avgResponseHours.toFixed(1)}h` : "—"}</td>
                <td>{v.onTimeRate != null ? pct(v.onTimeRate) : "—"}</td>
                <td>{pct(v.needsReviewRate)}</td>
                <td>{pct(v.bounceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
