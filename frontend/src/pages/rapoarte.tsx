import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useReports } from "@/lib/reports";

const SERIES = [
  { key: "ordersSent", label: "Comenzi trimise", color: "#15803d" },
  { key: "repliesParsed", label: "Răspunsuri procesate", color: "#65a30d" },
  { key: "followUpsSent", label: "Follow-up-uri", color: "#ca8a04" },
  { key: "botReplies", label: "Răspunsuri programări", color: "#0d9488" },
] as const;

function StatCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function EmptyChart() {
  return <p className="py-8 text-center text-sm text-muted-foreground">Nu există date încă</p>;
}

export function RapoartePage() {
  const { data, isLoading } = useReports();

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground">Se încarcă...</div>;
  }

  const { totals, weekly, automation, missingFields } = data;
  const hours = (totals.minutesSaved / 60).toFixed(1);
  const vendorTotal = automation.vendor.extracted + automation.vendor.needsReview;
  const autoRate = vendorTotal === 0 ? "—" : `${Math.round((automation.vendor.extracted / vendorTotal) * 100)}%`;
  const donutData = [
    { name: "Procesate automat", value: automation.vendor.extracted },
    { name: "Necesită verificare", value: automation.vendor.needsReview },
  ];
  const weeklyData = weekly.map((w) => ({ ...w, week: w.weekStart.slice(5) }));
  const anyActions = totals.ordersSent + totals.repliesParsed + totals.followUpsSent + totals.botReplies > 0;

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rapoarte</h1>
        <p className="mt-1 text-sm text-muted-foreground">Valoarea automatizării în ultimele 12 săptămâni</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Ore economisite" value={hours} hint="estimat" />
        <StatCard title="Follow-up-uri trimise" value={String(totals.followUpsSent)} />
        <StatCard
          title="Rată automatizare"
          value={autoRate}
          hint="răspunsuri furnizori procesate fără intervenție"
        />
      </div>

      <ChartCard title="Acțiuni automate pe săptămână">
        {!anyActions ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyData}>
              <XAxis dataKey="week" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Legend />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" name={s.label} fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Procesare răspunsuri furnizori">
          {vendorTotal === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                  <Cell fill="#15803d" />
                  <Cell fill="#ca8a04" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Câmpuri uitate de clienți">
          {missingFields.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={missingFields} layout="vertical">
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis type="category" dataKey="label" width={120} fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" name="Programări" fill="#0d9488" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
