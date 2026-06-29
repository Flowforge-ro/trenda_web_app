import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
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
          <p className="text-sm font-medium text-foreground">{feature.name}</p>
          <p className="text-xs text-muted-foreground">{feature.description}</p>
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
            rows={3}
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

export function ManageFeaturesDialog({ org }: { org: Organization }) {
  const [open, setOpen] = useState(false);
  const { data: features = [], isLoading } = useOrgFeatures(open ? org.id : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Funcționalități</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Funcționalități — {org.name}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Se încarcă...</p>
          ) : (
            features.map((f) => <FeatureRow key={f.key} orgId={org.id} feature={f} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
