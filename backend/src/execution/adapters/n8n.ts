import type { FeatureDefinition } from "../../features/types.js";
import type { ExecutionContext, ExecutionResult } from "../types.js";

export interface N8nDeps {
  fetch: typeof fetch;
}
const defaultDeps: N8nDeps = { fetch: globalThis.fetch };

/**
 * MVP execution adapter: POST the invocation to an n8n webhook. The webhook URL
 * comes from the company's config (`webhookUrl`) if present, else the feature
 * definition's executionRef. The body carries both payload and config so the
 * workflow can route on channel/variant internally — the feature key stays a
 * capability, never a channel (see features/types.ts).
 */
export async function runN8n(
  def: FeatureDefinition,
  ctx: ExecutionContext,
  deps: N8nDeps = defaultDeps
): Promise<ExecutionResult> {
  const url =
    (ctx.config && typeof ctx.config === "object" && (ctx.config as Record<string, unknown>).webhookUrl) ||
    def.executionRef;
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, error: "n8n feature missing webhook url" };
  }
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: ctx.orgId,
        featureKey: ctx.featureKey,
        payload: ctx.payload,
        config: ctx.config,
      }),
    });
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` };
    const data = await res.json().catch(() => undefined);
    return { ok: true, data };
  } catch {
    return { ok: false, error: "n8n webhook request failed" };
  }
}
