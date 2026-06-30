import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAnalytics, type FeatureAnalytics } from "@/lib/analytics";

function fmt(value: number, unit: "count" | "usd") {
  return unit === "usd" ? `$${value.toFixed(2)}` : value.toLocaleString("ro-RO");
}

// Distinct line colors per metric (cycled by index).
const LINE_COLORS = ["#16a34a", "#2563eb", "#d97706", "#db2777"];

function FeatureCard({ feature }: { feature: FeatureAnalytics }) {
  // Flatten trend points into recharts rows: { date, <metricKey>: value, ... }.
  const data = feature.trend.map((t) => ({ date: t.date, ...t.values }));
  const hasData = feature.metrics.some((m) => m.total > 0);

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{feature.name}</h2>

      <div className="grid grid-cols-2 gap-3">
        {feature.metrics.map((m) => (
          <div key={m.key} className="rounded-md bg-gray-50 p-3">
            <p className="text-2xl font-semibold text-foreground">{fmt(m.total, m.unit)}</p>
            <p className="text-xs text-muted-foreground">{m.label}</p>
          </div>
        ))}
      </div>

      {hasData ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(8)}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={36} />
              <Tooltip
                labelFormatter={(d) => `Ziua ${String(d).slice(8)} (${d})`}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {feature.metrics.map((m, i) => (
                <Line
                  key={m.key}
                  type="monotone"
                  dataKey={m.key}
                  name={m.label}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">Nicio activitate luna aceasta.</p>
      )}
    </section>
  );
}

export function AnalyticsPage() {
  const { data, isLoading, isError } = useAnalytics();
  const features = data?.features ?? [];

  return (
    <div className="p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Statistici</h1>
        <p className="mt-1 text-sm text-muted-foreground">Activitatea automatizată a companiei tale, luna curentă</p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : isError ? (
        <p className="text-sm text-error">Nu s-au putut încărca statisticile.</p>
      ) : features.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nicio funcționalitate activă încă.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {features.map((f) => (
            <FeatureCard key={f.key} feature={f} />
          ))}
        </div>
      )}
    </div>
  );
}
