import type { FeatureDefinition } from "../../features/types.js";
import type { ExecutionContext, ExecutionResult, FeatureHandler } from "../types.js";

/**
 * In-process feature handlers, keyed by a definition's executionRef. Empty for
 * now — populated as node-backed features are built (the preferred long-term path
 * away from n8n). Register at module init, e.g.:
 *
 *   registerNodeHandler("appointment_reminders", remindersHandler);
 */
const handlers = new Map<string, FeatureHandler>();

export function registerNodeHandler(ref: string, handler: FeatureHandler): void {
  handlers.set(ref, handler);
}

/** TEST-ONLY: clear the registry between cases. */
export function _resetNodeHandlers(): void {
  handlers.clear();
}

export async function runNode(
  def: FeatureDefinition,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  const ref = def.executionRef;
  if (!ref) return { ok: false, error: "node feature missing executionRef" };
  const handler = handlers.get(ref);
  if (!handler) return { ok: false, error: `no node handler registered for "${ref}"` };
  return handler(ctx);
}
