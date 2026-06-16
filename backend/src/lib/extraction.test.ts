import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrderInfo, mergeMissing, type ExtractionDeps, type ExtractionSource, type LlmProvider } from "./extraction.js";

const noopLogger = { info: () => {}, warn: () => {} };

type GenText = (source: ExtractionSource, today: string) => Promise<string>;
function provider(name: LlmProvider["name"], genText: GenText): LlmProvider {
  const model = `${name}-model`;
  return {
    name,
    model,
    generate: async (source, today) => ({
      text: await genText(source, today),
      usage: { provider: name, model, inputTokens: 10, outputTokens: 5 },
    }),
  };
}

// Primary returns the given JSON; fallback always throws so we know it wasn't used.
function fakeDeps(jsonText: string): ExtractionDeps {
  return {
    primary: provider("openai", async () => jsonText),
    fallback: provider("gemini", async () => {
      throw new Error("fallback should not be called");
    }),
    logger: noopLogger,
  };
}

function buildJson(o: {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  orderNumberQuote?: string | null;
  deliveryQuote?: string | null;
}): string {
  return JSON.stringify({ orderNumberQuote: null, deliveryQuote: null, ...o });
}

const D20 = new Date("2026-06-20T00:00:00.000Z");

const grounded = { orderNumberGrounded: true, deliveryGrounded: true };

test("extractOrderInfo (text): both fields present -> extracted", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-20" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("extractOrderInfo (text): a date range is parsed", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "saptamana viitoare", deliveryEarliest: "2026-06-08", deliveryLatest: "2026-06-12" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-12T00:00:00.000Z");
});

test("extractOrderInfo (text): order number but no delivery -> needs_review", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): only one delivery end present -> delivery not applied", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "2026-06-20", deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): all-null -> needs_review", async () => {
  const json = buildJson({ orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, null);
});

test("extractOrderInfo (text): invalid ISO date -> delivery miss", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "next week", deliveryLatest: "next week" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (binary): the provider receives the binary source", async () => {
  let received: ExtractionSource | null = null;
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    {
      primary: provider("openai", async (source) => { received = source; return json; }),
      fallback: provider("gemini", async () => { throw new Error("unused"); }),
      logger: noopLogger,
    }
  );
  assert.equal(r.orderNumber, "CMD7");
  const got = received as Extract<ExtractionSource, { kind: "binary" }> | null;
  assert.ok(got, "expected the provider to receive a source");
  assert.equal(got.kind, "binary");
  assert.equal(got.mimeType, "image/png");
  assert.equal(got.bytes.length, 3);
});

test("grounding (text): quote found in body -> grounded true", async () => {
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-20",
    orderNumberQuote: "CMD42", deliveryQuote: "20 iunie",
  });
  const r = await extractOrderInfo({ kind: "text", body: "Comanda CMD42 livrata pe 20 iunie." }, "2026-06-01", fakeDeps(json));
  assert.equal(r.orderNumberGrounded, true);
  assert.equal(r.deliveryGrounded, true);
});

test("grounding (text): quote absent from body -> grounded false (hallucination)", async () => {
  const json = buildJson({
    orderNumber: "CMD999", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null,
    orderNumberQuote: "CMD999",
  });
  const r = await extractOrderInfo({ kind: "text", body: "Comanda CMD42 confirmata." }, "2026-06-01", fakeDeps(json));
  assert.equal(r.orderNumberGrounded, false);
});

test("grounding (binary): not penalized (no source text) -> grounded true", async () => {
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    fakeDeps(json)
  );
  assert.equal(r.orderNumberGrounded, true);
  assert.equal(r.deliveryGrounded, true);
});

test("falls back to the secondary provider when the primary throws", async () => {
  const json = buildJson({ orderNumber: "FB1", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  let usedFallback = false;
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", {
    primary: provider("openai", async () => { throw new Error("openai down"); }),
    fallback: provider("gemini", async () => { usedFallback = true; return json; }),
    logger: noopLogger,
  });
  assert.equal(usedFallback, true);
  assert.equal(r.orderNumber, "FB1");
});

test("falls back when the primary returns empty / unparseable output", async () => {
  const json = buildJson({ orderNumber: "FB2", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  let usedFallback = false;
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", {
    primary: provider("openai", async () => ""),
    fallback: provider("gemini", async () => { usedFallback = true; return json; }),
    logger: noopLogger,
  });
  assert.equal(usedFallback, true);
  assert.equal(r.orderNumber, "FB2");
});

test("logs the provider that served the extraction", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const logged: Array<{ provider: unknown }> = [];
  await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", {
    primary: provider("openai", async () => json),
    fallback: provider("gemini", async () => { throw new Error("unused"); }),
    logger: { info: (o) => logged.push(o as { provider: unknown }), warn: () => {} },
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].provider, "openai");
});

test("extractOrderInfo surfaces the serving provider's token usage", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", fakeDeps(json));
  assert.equal(r.usage?.provider, "openai");
  assert.equal(r.usage?.inputTokens, 10);
  assert.equal(r.usage?.outputTokens, 5);
});

test("mergeMissing fills orderNumber from extra", () => {
  const base = { orderNumber: null, deliveryTime: null, deliveryEarliest: D20, deliveryLatest: D20, ...grounded, status: "needs_review" as const };
  const extra = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, ...grounded, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "extracted");
});

test("mergeMissing fills the delivery block from extra", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, ...grounded, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, ...grounded, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.deliveryTime, "20 iunie");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(r.status, "extracted");
});

test("mergeMissing does not overwrite values present in base", () => {
  const base = { orderNumber: "KEEP", deliveryTime: "keep", deliveryEarliest: D20, deliveryLatest: D20, ...grounded, status: "extracted" as const };
  const extra = { orderNumber: "OTHER", deliveryTime: "other", deliveryEarliest: new Date("2026-07-01T00:00:00.000Z"), deliveryLatest: new Date("2026-07-01T00:00:00.000Z"), ...grounded, status: "extracted" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "KEEP");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("mergeMissing leaves base unchanged when extra is all null", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, ...grounded, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, ...grounded, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "needs_review");
});
