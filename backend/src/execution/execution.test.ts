import { test } from "node:test";
import assert from "node:assert/strict";
import type { FeatureDefinition } from "../features/types.js";
import { runNode, registerNodeHandler, _resetNodeHandlers } from "./adapters/node.js";
import { runN8n } from "./adapters/n8n.js";
import { route } from "./router.js";
import { executeFeature, type ExecuteFeatureDeps } from "./execute-feature.js";

const ctx = { orgId: "O1", featureKey: "vendor_communication", config: {}, payload: { a: 1 } };

// ---------------------------------------------------------------------------
// node adapter
// ---------------------------------------------------------------------------

test("runNode fails when the definition has no executionRef", async () => {
  const def = { key: "x", name: "X", description: "", executionType: "node" } as FeatureDefinition;
  assert.deepEqual(await runNode(def, ctx), { ok: false, error: "node feature missing executionRef" });
});

test("runNode fails when no handler is registered", async () => {
  _resetNodeHandlers();
  const def = { key: "x", name: "X", description: "", executionType: "node", executionRef: "h1" } as FeatureDefinition;
  const r = await runNode(def, ctx);
  assert.equal(r.ok, false);
  assert.match(r.error!, /no node handler/);
});

test("runNode invokes the registered handler", async () => {
  _resetNodeHandlers();
  registerNodeHandler("h1", async (c) => ({ ok: true, data: c.payload }));
  const def = { key: "x", name: "X", description: "", executionType: "node", executionRef: "h1" } as FeatureDefinition;
  assert.deepEqual(await runNode(def, ctx), { ok: true, data: { a: 1 } });
});

// ---------------------------------------------------------------------------
// n8n adapter
// ---------------------------------------------------------------------------

test("runN8n fails without a webhook url", async () => {
  const def = { key: "x", name: "X", description: "", executionType: "n8n" } as FeatureDefinition;
  const r = await runN8n(def, ctx, { fetch: (async () => { throw new Error("nope"); }) as any });
  assert.deepEqual(r, { ok: false, error: "n8n feature missing webhook url" });
});

test("runN8n posts to executionRef and returns data on 200", async () => {
  let calledUrl = "";
  const def = { key: "x", name: "X", description: "", executionType: "n8n", executionRef: "http://hook" } as FeatureDefinition;
  const fetch = (async (url: string) => { calledUrl = url; return { ok: true, status: 200, json: async () => ({ done: true }) }; }) as any;
  const r = await runN8n(def, ctx, { fetch });
  assert.equal(calledUrl, "http://hook");
  assert.deepEqual(r, { ok: true, data: { done: true } });
});

test("runN8n prefers config.webhookUrl over executionRef", async () => {
  let calledUrl = "";
  const def = { key: "x", name: "X", description: "", executionType: "n8n", executionRef: "http://default" } as FeatureDefinition;
  const fetch = (async (url: string) => { calledUrl = url; return { ok: true, status: 200, json: async () => ({}) }; }) as any;
  await runN8n(def, { ...ctx, config: { webhookUrl: "http://override" } }, { fetch });
  assert.equal(calledUrl, "http://override");
});

test("runN8n reports a non-ok status", async () => {
  const def = { key: "x", name: "X", description: "", executionType: "n8n", executionRef: "http://hook" } as FeatureDefinition;
  const fetch = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as any;
  assert.deepEqual(await runN8n(def, ctx, { fetch }), { ok: false, error: "n8n webhook returned 502" });
});

test("runN8n catches network errors", async () => {
  const def = { key: "x", name: "X", description: "", executionType: "n8n", executionRef: "http://hook" } as FeatureDefinition;
  const fetch = (async () => { throw new Error("ECONNREFUSED"); }) as any;
  assert.deepEqual(await runN8n(def, ctx, { fetch }), { ok: false, error: "n8n webhook request failed" });
});

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

test("route throws for native features", async () => {
  const def = { key: "vendor_communication", name: "V", description: "", executionType: "native" } as FeatureDefinition;
  await assert.rejects(() => route(def, ctx), /native/);
});

// ---------------------------------------------------------------------------
// executeFeature
// ---------------------------------------------------------------------------

function execDeps(opts: {
  orgExists?: boolean;
  assignment?: { enabled: boolean; config: unknown } | null;
  route?: ExecuteFeatureDeps["route"];
  onLog?: (data: any) => void;
}): ExecuteFeatureDeps {
  const { orgExists = true, assignment = { enabled: true, config: {} }, onLog } = opts;
  return {
    prisma: {
      organization: { findUnique: async () => (orgExists ? { id: "O1" } : null) },
      organizationFeature: { findUnique: async () => assignment },
      executionLog: { create: async ({ data }: any) => { onLog?.(data); return data; } },
    } as any,
    route: opts.route ?? (async () => ({ adapter: "node", result: { ok: true } })),
  };
}

test("executeFeature returns org_not_found and does not log", async () => {
  let logged = false;
  const r = await executeFeature("ghost", "vendor_communication", {}, execDeps({ orgExists: false, onLog: () => { logged = true; } }));
  assert.deepEqual(r, { ok: false, error: "org_not_found" });
  assert.equal(logged, false);
});

test("executeFeature returns feature_not_enabled when disabled", async () => {
  const r = await executeFeature("O1", "vendor_communication", {}, execDeps({ assignment: { enabled: false, config: {} } }));
  assert.deepEqual(r, { ok: false, error: "feature_not_enabled" });
});

test("executeFeature returns unknown_feature for an unregistered key", async () => {
  const r = await executeFeature("O1", "ghost_feature", {}, execDeps({}));
  assert.deepEqual(r, { ok: false, error: "unknown_feature" });
});

test("executeFeature logs ok result with the adapter and a duration", async () => {
  let log: any;
  const r = await executeFeature(
    "O1",
    "vendor_communication",
    { x: 1 },
    execDeps({ route: async () => ({ adapter: "n8n", result: { ok: true, data: 42 } }), onLog: (d) => (log = d) })
  );
  assert.deepEqual(r, { ok: true, data: 42 });
  assert.equal(log.adapter, "n8n");
  assert.equal(log.ok, true);
  assert.equal(log.error, null);
  assert.equal(typeof log.durationMs, "number");
});

test("executeFeature logs ok:false when the router throws (native misuse)", async () => {
  let log: any;
  const r = await executeFeature(
    "O1",
    "vendor_communication",
    {},
    execDeps({ route: async () => { throw new Error("is native"); }, onLog: (d) => (log = d) })
  );
  assert.equal(r.ok, false);
  assert.match(r.error!, /native/);
  assert.equal(log.ok, false);
  assert.equal(log.adapter, "native"); // falls back to the definition's executionType
});
