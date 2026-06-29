import type { FeatureDefinition } from "./types.js";
import { vendorCommunication } from "./definitions/vendor-communication.js";
import { customerCommunication } from "./definitions/customer-communication.js";

/**
 * The product catalog. Add a new feature by appending its definition here.
 * Code is the source of truth — the database (OrganizationFeature) only records
 * which companies have each feature enabled and their per-company config.
 */
const definitions: readonly FeatureDefinition[] = [
  vendorCommunication,
  customerCommunication,
];

export const FEATURE_REGISTRY: Readonly<Record<string, FeatureDefinition>> = Object.freeze(
  Object.fromEntries(definitions.map((d) => [d.key, d]))
);

/** Keys of the seed (wrap-only) features, enabled for existing/new orgs by default. */
export const SEED_FEATURE_KEYS: readonly string[] = [
  vendorCommunication.key,
  customerCommunication.key,
];

export function listFeatures(): FeatureDefinition[] {
  return Object.values(FEATURE_REGISTRY);
}

export function getFeature(key: string): FeatureDefinition | undefined {
  return FEATURE_REGISTRY[key];
}

export function isValidFeatureKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_REGISTRY, key);
}
