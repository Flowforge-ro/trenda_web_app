import type { FeatureDefinition } from "../types.js";

/**
 * Existing orders pipeline: poll the inbox, extract order data with the LLM, and
 * reply to vendors over Microsoft Graph (modules/orders, modules/poll).
 *
 * Wrap-only: registered as a feature for access-control + UI gating. Its runtime
 * stays in the orders module — hence executionType "native" (the execution
 * router is never involved).
 */
export const vendorCommunication: FeatureDefinition = {
  key: "vendor_communication",
  name: "Comunicare furnizori",
  description: "Automatizarea comenzilor și a comunicării cu furnizorii (Comenzi).",
  executionType: "native",
  requiresMailbox: true,
  usageMetrics: [
    { key: "orders", label: "Comenzi", kind: "outcome", unit: "count", clientVisible: true },
    { key: "emailsSent", label: "Emailuri trimise", kind: "resource", unit: "count", clientVisible: true },
    { key: "llmCostUsd", label: "Cost AI (USD)", kind: "resource", unit: "usd" },
  ],
};
