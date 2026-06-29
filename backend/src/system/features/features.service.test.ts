import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCatalog,
  listOrgFeatures,
  setOrgFeature,
  type FeaturesDeps,
} from "./features.service.js";

function makeDeps(opts: { orgExists?: boolean; rows?: any[]; onUpsert?: (a: any) => void } = {}): FeaturesDeps {
  const { orgExists = true, rows = [], onUpsert } = opts;
  return {
    prisma: {
      organization: {
        findUnique: async ({ where }: any) => (orgExists ? { id: where.id } : null),
      },
      organizationFeature: {
        findMany: async () => rows,
        upsert: async (args: any) => { onUpsert?.(args); return {}; },
      },
      // Used by listOrgFeatures -> getFeatureUsage.
      usageEvent: { groupBy: async () => [] },
      order: { count: async () => 0 },
      appointment: { count: async () => 0 },
    } as any,
  };
}

test("getCatalog returns the seed features without zod internals", () => {
  const cat = getCatalog();
  const vendor = cat.find((f) => f.key === "vendor_communication");
  assert.equal(vendor?.executionType, "native");
  assert.equal(vendor?.hasConfigSchema, false);
  assert.equal((vendor as any).configSchema, undefined);
});

test("listOrgFeatures merges every catalog feature with stored state", async () => {
  const deps = makeDeps({ rows: [{ featureKey: "vendor_communication", enabled: true, config: { a: 1 } }] });
  const r = await listOrgFeatures("O1", deps);
  assert.ok(r);
  const vendor = r!.find((f) => f.key === "vendor_communication")!;
  const customer = r!.find((f) => f.key === "customer_communication")!;
  assert.equal(vendor.enabled, true);
  assert.deepEqual(vendor.config, { a: 1 });
  assert.equal(customer.enabled, false); // unassigned -> default
  assert.deepEqual(customer.config, {});
});

test("listOrgFeatures returns null for a missing org", async () => {
  const r = await listOrgFeatures("ghost", makeDeps({ orgExists: false }));
  assert.equal(r, null);
});

test("setOrgFeature rejects an unknown feature key", async () => {
  const r = await setOrgFeature("O1", "nope", { enabled: true }, makeDeps());
  assert.deepEqual(r, { error: "unknown_feature" });
});

test("setOrgFeature returns org_not_found when the org is missing", async () => {
  const r = await setOrgFeature("ghost", "vendor_communication", { enabled: true }, makeDeps({ orgExists: false }));
  assert.deepEqual(r, { error: "org_not_found" });
});

test("setOrgFeature upserts with enabled + config", async () => {
  let captured: any;
  const r = await setOrgFeature(
    "O1",
    "vendor_communication",
    { enabled: true, config: { channel: "email" } },
    makeDeps({ onUpsert: (a) => (captured = a) })
  );
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(captured.where, { orgId_featureKey: { orgId: "O1", featureKey: "vendor_communication" } });
  assert.equal(captured.create.enabled, true);
  assert.deepEqual(captured.update.config, { channel: "email" });
});

test("setOrgFeature persists valid metric limits", async () => {
  let captured: any;
  const r = await setOrgFeature(
    "O1",
    "vendor_communication",
    { enabled: true, limits: { orders: 100, emailsSent: 500 } },
    makeDeps({ onUpsert: (a) => (captured = a) })
  );
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(captured.update.limits, { orders: 100, emailsSent: 500 });
});

test("setOrgFeature rejects a limit on a metric the feature does not declare", async () => {
  const r = await setOrgFeature(
    "O1",
    "vendor_communication",
    { enabled: true, limits: { appointments: 5 } }, // appointments is a customer metric
    makeDeps()
  );
  assert.deepEqual(r, { error: "invalid_limits" });
});

test("listOrgFeatures includes limits and current-period usage", async () => {
  const deps = makeDeps({ rows: [{ featureKey: "vendor_communication", enabled: true, config: {}, limits: { orders: 10 } }] });
  const r = await listOrgFeatures("O1", deps);
  const vendor = r!.find((f) => f.key === "vendor_communication")!;
  assert.deepEqual(vendor.limits, { orders: 10 });
  assert.equal(vendor.usage.orders.limit, 10);
  assert.equal(vendor.usage.orders.used, 0); // fake counts return 0
  assert.equal(vendor.usage.orders.over, false);
});
