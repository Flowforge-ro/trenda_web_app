import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgFeatures, useSetOrgFeature, type OrgFeature } from "@/lib/features";
import type { Organization } from "@/lib/organizations";

function FeatureRow({ orgId, feature }: { orgId: string; feature: OrgFeature }) {
  const setFeature = useSetOrgFeature();
  // Local draft of the config JSON so superadmins can edit before saving.
  const [configText, setConfigText] = useState(() => JSON.stringify(feature.config ?? {}, null, 2));
  const [configError, setConfigError] = useState<string | null>(null);

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
    setFeature.mutate({ orgId, key: feature.key, enabled, config });
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
