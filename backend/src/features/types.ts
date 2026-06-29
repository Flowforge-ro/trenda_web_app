import type { z } from "zod";

/**
 * How a feature is executed at runtime.
 * - "native": handled directly inside an existing module (current behaviour).
 *   The execution router is NOT involved — see src/execution.
 * - "n8n":    routed to an n8n webhook (MVP execution layer).
 * - "node":   routed to an in-process Node handler (preferred long-term).
 */
export type ExecutionType = "native" | "n8n" | "node";

/**
 * A FEATURE is a sellable product capability (the SKU), not a workflow and not a
 * channel. Definitions live in code (the registry) — the database only stores
 * per-company assignment + config (OrganizationFeature).
 *
 * Granularity rule: the key names a *capability* (e.g. "appointment_reminders"),
 * never a channel ("whatsapp") or a channel×capability combo
 * ("whatsapp_reminder"). Channel / timing / templates / thresholds belong in
 * `config` (validated by `configSchema`); the n8n workflow or node handler reads
 * config and routes internally.
 */
export interface FeatureDefinition {
  /** Stable capability key. Used as the assignment key and UI-gating token. */
  key: string;
  /** Human-readable name shown in the superadmin UI. */
  name: string;
  /** Short description of the capability. */
  description: string;
  executionType: ExecutionType;
  /**
   * n8n webhook URL/id, or node handler key. Unused for "native" features.
   * May be overridden per-company via config when it varies by tenant.
   */
  executionRef?: string;
  /**
   * Validates `OrganizationFeature.config`. When omitted, any JSON object is
   * accepted. This is where channel/variant knobs are declared.
   */
  configSchema?: z.ZodType;
}
