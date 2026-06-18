import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrderInfo, mergeMissing, normalizePrice, resolveRelativeDelivery, type ExtractionDeps, type ExtractionSource, type ExtractionContext, type LlmProvider } from "./extraction.js";

const noopLogger = { info: () => {}, warn: () => {} };

type GenText = (source: ExtractionSource, today: string, ctx: ExtractionContext) => Promise<string>;
function provider(name: LlmProvider["name"], genText: GenText): LlmProvider {
  const model = `${name}-model`;
  return {
    name,
    model,
    generate: async (source, today, ctx) => ({
      text: await genText(source, today, ctx),
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

const grounded = { orderNumberGrounded: true, deliveryGrounded: true, isOffer: false, price: null as string | null };

const WED = new Date("2026-06-17T00:00:00.000Z"); // Wednesday
const SAT = new Date("2026-06-20T00:00:00.000Z"); // Saturday
const iso = (d: Date | undefined) => d?.toISOString().slice(0, 10);

test("resolveRelativeDelivery: working-day range excludes weekends", () => {
  const r = resolveRelativeDelivery("5-7 zile lucrătoare", WED);
  assert.equal(iso(r?.earliest), "2026-06-24");
  assert.equal(iso(r?.latest), "2026-06-26");
});

test("resolveRelativeDelivery: single working-day value sets earliest == latest", () => {
  const r = resolveRelativeDelivery("5 zile lucrătoare", WED);
  assert.equal(iso(r?.earliest), "2026-06-24");
  assert.equal(iso(r?.latest), "2026-06-24");
});

test("resolveRelativeDelivery: calendar days do not skip weekends", () => {
  const r = resolveRelativeDelivery("3 zile", WED);
  assert.equal(iso(r?.earliest), "2026-06-20");
  assert.equal(iso(r?.latest), "2026-06-20");
});

test("resolveRelativeDelivery: anchored on a weekend, working days start Monday", () => {
  const r = resolveRelativeDelivery("5 zile lucrătoare", SAT);
  assert.equal(iso(r?.earliest), "2026-06-26"); // Sun skipped, Mon..Fri = 5
  assert.equal(iso(r?.latest), "2026-06-26");
});

test("resolveRelativeDelivery: 14 working days spans two weekends", () => {
  const r = resolveRelativeDelivery("14 zile lucratoare", WED);
  assert.equal(iso(r?.earliest), "2026-07-07");
  assert.equal(iso(r?.latest), "2026-07-07");
});

test("resolveRelativeDelivery: abbreviations are treated as working days", () => {
  for (const phrase of ["5-7 zile lucr", "5-7 zile lucr.", "5–7 zile l."]) {
    const r = resolveRelativeDelivery(phrase, WED);
    assert.equal(iso(r?.earliest), "2026-06-24", phrase);
    assert.equal(iso(r?.latest), "2026-06-26", phrase);
  }
});

test("resolveRelativeDelivery: non-day phrases and exact dates return null", () => {
  assert.equal(resolveRelativeDelivery("săptămâna viitoare", WED), null);
  assert.equal(resolveRelativeDelivery("20 iunie", WED), null);
  assert.equal(resolveRelativeDelivery("livrare pe 25.06", WED), null);
  assert.equal(resolveRelativeDelivery(null, WED), null);
});

test("resolveRelativeDelivery: a reversed range (max < min) is rejected", () => {
  assert.equal(resolveRelativeDelivery("7-5 zile lucrătoare", WED), null);
});

test("extractOrderInfo (text): both fields present -> extracted", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "20 iunie", deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-20" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("extractOrderInfo (text): a date range is parsed", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "saptamana viitoare", deliveryEarliest: "2026-06-08", deliveryLatest: "2026-06-12" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "extracted");
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-08T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-12T00:00:00.000Z");
});

test("extractOrderInfo (text): order number but no delivery -> needs_review", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, "CMD42");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): only one delivery end present -> delivery not applied", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "2026-06-20", deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (text): all-null -> needs_review", async () => {
  const json = buildJson({ orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.orderNumber, null);
});

test("extractOrderInfo (text): invalid ISO date -> delivery miss", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: "candva", deliveryEarliest: "next week", deliveryLatest: "next week" });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.status, "needs_review");
  assert.equal(r.deliveryEarliest, null);
});

test("extractOrderInfo (binary): the provider receives the binary source", async () => {
  let received: ExtractionSource | null = null;
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    { partCode: null },
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
  const r = await extractOrderInfo({ kind: "text", body: "Comanda CMD42 livrata pe 20 iunie." }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.orderNumberGrounded, true);
  assert.equal(r.deliveryGrounded, true);
});

test("grounding (text): quote absent from body -> grounded false (hallucination)", async () => {
  const json = buildJson({
    orderNumber: "CMD999", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null,
    orderNumberQuote: "CMD999",
  });
  const r = await extractOrderInfo({ kind: "text", body: "Comanda CMD42 confirmata." }, "2026-06-01", { partCode: null }, fakeDeps(json));
  assert.equal(r.orderNumberGrounded, false);
});

test("grounding (binary): not penalized (no source text) -> grounded true", async () => {
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    { partCode: null },
    fakeDeps(json)
  );
  assert.equal(r.orderNumberGrounded, true);
  assert.equal(r.deliveryGrounded, true);
});

test("falls back to the secondary provider when the primary throws", async () => {
  const json = buildJson({ orderNumber: "FB1", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  let usedFallback = false;
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, {
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
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, {
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
  await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, {
    primary: provider("openai", async () => json),
    fallback: provider("gemini", async () => { throw new Error("unused"); }),
    logger: { info: (o) => logged.push(o as { provider: unknown }), warn: () => {} },
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].provider, "openai");
});

test("extractOrderInfo surfaces the serving provider's token usage", async () => {
  const json = buildJson({ orderNumber: "CMD42", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-01", { partCode: null }, fakeDeps(json));
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

test("relative lead time 'zile lucrătoare' is re-resolved from today (not the model dates)", async () => {
  // Model anchored to a stale offer date -> past window. Override fixes it.
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "5-7 zile lucrătoare",
    deliveryEarliest: "2026-05-01", deliveryLatest: "2026-05-03",
  });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  // 2026-06-17 is a Wednesday: +5 business days = Wed 06-24, +7 = Fri 06-26.
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-24T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-26T00:00:00.000Z");
  assert.equal(r.status, "extracted");
});

test("abbreviated working-days phrases all exclude weekends (consistent window)", async () => {
  // All of these mean business days: Wed 06-17 + 5 b.d. = 06-24, + 7 b.d. = 06-26.
  for (const phrase of ["5-7 zile lucrătoare", "5-7 zile lucratoare", "5-7 zile lucr", "5-7 zile lucr.", "5–7 zile l."]) {
    const json = buildJson({
      orderNumber: "CMD42", deliveryTime: phrase,
      deliveryEarliest: "2026-05-01", deliveryLatest: "2026-05-03",
    });
    const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-17", { partCode: null }, fakeDeps(json));
    assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-24T00:00:00.000Z", `earliest for "${phrase}"`);
    assert.equal(r.deliveryLatest?.toISOString(), "2026-06-26T00:00:00.000Z", `latest for "${phrase}"`);
  }
});

test("'14 zile lucratoare' excludes weekends", async () => {
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "14 zile lucratoare",
    deliveryEarliest: "2026-05-01", deliveryLatest: "2026-05-01",
  });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  // Wed 06-17 + 14 business days = Tue 07-07 (two weekends skipped).
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-07-07T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-07-07T00:00:00.000Z");
});

test("relative lead time 'zile' (calendar) is re-resolved from today", async () => {
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "3 zile",
    deliveryEarliest: "2026-05-01", deliveryLatest: "2026-05-01",
  });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-20T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-20T00:00:00.000Z");
});

test("relative lead time resolves even when the model returned no dates", async () => {
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "2 zile lucrătoare",
    deliveryEarliest: null, deliveryLatest: null, deliveryQuote: "2 zile lucrătoare",
  });
  const r = await extractOrderInfo({ kind: "text", body: "livrare 2 zile lucrătoare" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  // Wed 06-17 + 2 business days = Fri 06-19.
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-19T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-19T00:00:00.000Z");
  assert.equal(r.status, "extracted");
});

test("a normalized working-day range with null dates is resolved from today", async () => {
  // The model maps a vague phrase ("săptămâna viitoare") to a range and leaves dates null.
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "3-8 zile lucrătoare",
    deliveryEarliest: null, deliveryLatest: null, deliveryQuote: "săptămâna viitoare",
  });
  const r = await extractOrderInfo({ kind: "text", body: "livrare săptămâna viitoare" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  // Wed 06-17: +3 b.d. = Mon 06-22, +8 b.d. = Mon 06-29.
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-22T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-29T00:00:00.000Z");
  assert.equal(r.status, "extracted");
});

test("absolute delivery dates are left untouched when no relative phrase", async () => {
  const json = buildJson({
    orderNumber: "CMD42", deliveryTime: "20 iunie",
    deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-20",
  });
  const r = await extractOrderInfo({ kind: "text", body: "body" }, "2026-06-17", { partCode: null }, fakeDeps(json));
  assert.equal(r.deliveryEarliest?.toISOString(), "2026-06-20T00:00:00.000Z");
  assert.equal(r.deliveryLatest?.toISOString(), "2026-06-20T00:00:00.000Z");
});

test("extractOrderInfo surfaces isOffer and price from the model", async () => {
  const deps = fakeDeps(JSON.stringify({
    orderNumber: "CMD-1", deliveryEarliest: "2026-07-01", deliveryLatest: "2026-07-01",
    deliveryTime: "1 iulie", orderNumberQuote: "CMD-1", deliveryQuote: "1 iulie",
    isOffer: true, price: "120 RON",
  }));
  const r = await extractOrderInfo({ kind: "text", body: "CMD-1 1 iulie" }, "2026-06-17", { partCode: "ABC" }, deps);
  assert.equal(r.isOffer, true);
  assert.equal(r.price, "120 RON");
});

test("normalizePrice maps lei/ron (any case) to RON, leaves other currencies", () => {
  assert.equal(normalizePrice("1.234,56 lei"), "1.234,56 RON");
  assert.equal(normalizePrice("500 RON"), "500 RON");
  assert.equal(normalizePrice("500 ron"), "500 RON");
  assert.equal(normalizePrice("1200 LEI"), "1200 RON");
  assert.equal(normalizePrice("1.200 EUR"), "1.200 EUR");
  assert.equal(normalizePrice("99 USD"), "99 USD");
  assert.equal(normalizePrice(null), null);
});

test("extractOrderInfo normalizes a lei price to RON", async () => {
  const deps = fakeDeps(JSON.stringify({
    orderNumber: "CMD-1", deliveryEarliest: "2026-07-01", deliveryLatest: "2026-07-01",
    deliveryTime: "1 iulie", orderNumberQuote: "CMD-1", deliveryQuote: "1 iulie",
    isOffer: true, price: "350 lei",
  }));
  const r = await extractOrderInfo({ kind: "text", body: "350 lei" }, "2026-06-17", { partCode: "ABC" }, deps);
  assert.equal(r.price, "350 RON");
});

test("extractOrderInfo defaults isOffer=false and price=null when absent", async () => {
  const deps = fakeDeps(JSON.stringify({
    orderNumber: "CMD-2", deliveryEarliest: "2026-07-01", deliveryLatest: "2026-07-01",
    deliveryTime: "1 iulie", orderNumberQuote: "CMD-2", deliveryQuote: "1 iulie",
    isOffer: false, price: null,
  }));
  const r = await extractOrderInfo({ kind: "text", body: "CMD-2" }, "2026-06-17", { partCode: "ABC" }, deps);
  assert.equal(r.isOffer, false);
  assert.equal(r.price, null);
});
