import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOrderInfo, mergeMissing, type ExtractionDeps, type ContentPart } from "./extraction.js";

function fakeDeps(jsonText: string): ExtractionDeps {
  return { generate: async () => jsonText };
}

function buildJson(o: {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}): string {
  return JSON.stringify(o);
}

const D20 = new Date("2026-06-20T00:00:00.000Z");

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

test("extractOrderInfo (binary): sends an inlineData part with the mime type", async () => {
  let received: ContentPart[] = [];
  const json = buildJson({ orderNumber: "CMD7", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null });
  const r = await extractOrderInfo(
    { kind: "binary", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    "2026-06-01",
    { generate: async (parts) => { received = parts; return json; } }
  );
  assert.equal(r.orderNumber, "CMD7");
  const inline = received.find((p) => "inlineData" in p) as Extract<ContentPart, { inlineData: unknown }> | undefined;
  assert.ok(inline, "expected an inlineData part");
  assert.equal(inline!.inlineData.mimeType, "image/png");
  assert.equal(Buffer.from(inline!.inlineData.data, "base64").length, 3);
});

test("mergeMissing fills orderNumber from extra", () => {
  const base = { orderNumber: null, deliveryTime: null, deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const extra = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "extracted");
});

test("mergeMissing fills the delivery block from extra", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: "20 iunie", deliveryEarliest: D20, deliveryLatest: D20, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.deliveryTime, "20 iunie");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
  assert.equal(r.status, "extracted");
});

test("mergeMissing does not overwrite values present in base", () => {
  const base = { orderNumber: "KEEP", deliveryTime: "keep", deliveryEarliest: D20, deliveryLatest: D20, status: "extracted" as const };
  const extra = { orderNumber: "OTHER", deliveryTime: "other", deliveryEarliest: new Date("2026-07-01T00:00:00.000Z"), deliveryLatest: new Date("2026-07-01T00:00:00.000Z"), status: "extracted" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "KEEP");
  assert.equal(r.deliveryEarliest?.toISOString(), D20.toISOString());
});

test("mergeMissing leaves base unchanged when extra is all null", () => {
  const base = { orderNumber: "CMD9", deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const extra = { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, status: "needs_review" as const };
  const r = mergeMissing(base, extra);
  assert.equal(r.orderNumber, "CMD9");
  assert.equal(r.status, "needs_review");
});
