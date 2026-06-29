import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgFeatures, useSetOrgFeature, type OrgFeature } from "@/lib/features";
import type { Organization } from "@/lib/organizations";

function fmt(value: number, unit?: "count" | "usd") {
  return unit === "usd" ? `$${value.toFixed(2)}` : String(value);
}

function FeatureRow({ orgId, feature }: { orgId: string; feature: OrgFeature }) {
  const setFeature = useSetOrgFeature();
  // Local drafts so superadmins can edit before saving.
  const [configText, setConfigText] = useState(() => JSON.stringify(feature.config ?? {}, null, 2));
  const [configError, setConfigError] = useState<string | null>(null);
  // Per-metric limit inputs as strings ("" = unlimited).
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(feature.usageMetrics.map((m) => [m.key, feature.limits[m.key]?.toString() ?? ""]))
  );

  function buildLimits(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of feature.usageMetrics) {
      const raw = limitDraft[m.key]?.trim();
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) out[m.key] = n;
      }
    }
    return out;
  }

  function save(enabled: boolean) {
    let config: unknown = {};
    if (configText.trim()) {
      try {
        config = JSON.parse(configText);
      } catch {
        setConfigError("Configurație JSON invalidă");
        return;
      }
    }
    setConfigError(null);
    setFeature.mutate({ orgId, key: feature.key, enabled, config, limits: buildLimits() });
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{feature.name}</p>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                feature.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
              }`}
            >
              {feature.enabled ? "Activă" : "Inactivă"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{feature.description}</p>
          <code className="text-[11px] text-muted-foreground">{feature.key}</code>
        </div>
        <Button
          variant={feature.enabled ? "outline" : "default"}
          size="sm"
          disabled={setFeature.isPending}
          onClick={() => save(!feature.enabled)}
        >
          {feature.enabled ? "Dezactivează" : "Activează"}
        </Button>
      </div>

      {feature.enabled && feature.usageMetrics.length > 0 && (
        <div className="space-y-2 rounded-md bg-gray-50 p-3">
          <p className="text-xs font-medium text-muted-foreground">Utilizare lunară &amp; limite</p>
          <div className="space-y-2">
            {feature.usageMetrics.map((m) => {
              const u = feature.usage[m.key];
              const over = u?.over ?? false;
              return (
                <div key={m.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm text-foreground">{m.label}</span>
                    <span className={`ml-2 text-xs ${over ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                      {fmt(u?.used ?? 0, m.unit)}
                      {u?.limit != null ? ` / ${fmt(u.limit, m.unit)}` : " / ∞"}
                      {over ? " — depășit" : ""}
                    </span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={m.unit === "usd" ? "0.01" : "1"}
                    placeholder="∞"
                    value={limitDraft[m.key] ?? ""}
                    onChange={(e) => setLimitDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                    className="h-7 w-24 rounded-md border border-input bg-transparent px-2 text-right text-xs"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={setFeature.isPending} onClick={() => save(true)}>
              Salvează limitele
            </Button>
          </div>
        </div>
      )}

      {feature.enabled && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Configurație (JSON)</label>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full rounded-lg border border-input bg-transparent p-2 font-mono text-xs"
          />
          {configError && <p className="text-xs text-error">{configError}</p>}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={setFeature.isPending} onClick={() => save(true)}>
              Salvează configurația
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Full per-org feature-management page, shown inside the superadmin panel. */
export function OrgFeaturesPage({ org, onBack }: { org: Organization; onBack: () => void }) {
  const { data: features = [], isLoading } = useOrgFeatures(org.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Înapoi
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{org.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Funcționalitățile alocate acestui client. Clienții văd doar interfața funcționalităților active.
        </p>
      </div>

      <div className="grid gap-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă...</p>
        ) : (
          features.map((f) => <FeatureRow key={f.key} orgId={org.id} feature={f} />)
        )}
      </div>
    </div>
  );
}
