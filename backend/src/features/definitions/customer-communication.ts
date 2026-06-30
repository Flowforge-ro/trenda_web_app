import type { FeatureDefinition } from "../types.js";

/**
 * Existing appointments pipeline: collect appointment details from customers over
 * email (modules/appointments).
 *
 * Wrap-only: registered as a feature for access-control + UI gating. Its runtime
 * stays in the appointments module — hence executionType "native".
 */
export const customerCommunication: FeatureDefinition = {
  key: "customer_communication",
  name: "Comunicare clienți",
  description: "Colectarea programărilor și comunicarea cu clienții (Programări).",
  executionType: "native",
  requiresMailbox: true,
  usageMetrics: [
    { key: "appointments", label: "Programări", kind: "outcome", unit: "count", clientVisible: true },
    { key: "emailsSent", label: "Emailuri trimise", kind: "resource", unit: "count", clientVisible: true },
    { key: "llmCostUsd", label: "Cost AI (USD)", kind: "resource", unit: "usd" },
  ],
};
