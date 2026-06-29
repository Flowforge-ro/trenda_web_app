/**
 * Execution layer types. This layer is the hidden runtime that runs *non-native*
 * features. It is NEVER exposed to customers — only executeFeature() and, later,
 * feature handlers/workflows touch it.
 */

export type Adapter = "n8n" | "node";

/** Everything a handler/adapter needs to run one feature invocation. */
export interface ExecutionContext {
  orgId: string;
  featureKey: string;
  /** The company's stored config for this feature (channel/variant/etc.). */
  config: unknown;
  /** The caller-supplied input for this invocation. */
  payload: unknown;
}

export interface ExecutionResult {
  ok: boolean;
  data?: unknown;
  /** Stable, non-sensitive reason string when ok is false. */
  error?: string;
}

/** A node-side feature implementation (the preferred long-term path). */
export type FeatureHandler = (ctx: ExecutionContext) => Promise<ExecutionResult>;
