import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAppointment,
  buildAppointmentParts,
  buildSchema,
  buildOpenAiResponseFormat,
  mergeFields,
  missingRequired,
  nextStatus,
  type AppointmentField,
  type AppointmentLlmProvider,
  type AppointmentExtractionDeps,
} from "./appointment-extraction.js";

const USAGE = { provider: "openai" as const, model: "gpt-5.4-mini", inputTokens: 12, outputTokens: 8 };
const silentLogger = { info() {}, warn() {} };

/** A provider whose generate() returns a fixed JSON string (or throws). */
function fakeProvider(
  name: "openai" | "gemini",
  impl: () => string
): AppointmentLlmProvider {
  return { name, model: "fake", generate: async () => ({ text: impl(), usage: { ...USAGE, provider: name } }) };
}

/** Deps where the primary serves `text`; fallback unused unless primary throws. */
function depsServing(text: string): AppointmentExtractionDeps {
  return { primary: fakeProvider("openai", () => text), fallback: fakeProvider("gemini", () => text), logger: silentLogger };
}

const FIELDS: AppointmentField[] = [
  { key: "nume", label: "Nume", description: "Numele complet al clientului", required: true },
  { key: "telefon", label: "Telefon", description: "Număr de telefon de contact", required: true },
  { key: "dataDorita", label: "Data dorită", description: "Data programării, ISO YYYY-MM-DD; rezolvă expresii vagi față de azi", required: true },
];

test("classifies appointment and extracts fields", async () => {
  const deps = depsServing(JSON.stringify({ intent: "appointment", nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" }));
  const r = await extractAppointment("Bună, vreau o programare pe 20 iunie. Ion Pop", FIELDS, "2026-06-12", { classify: true }, deps);
  assert.equal(r.intent, "appointment");
  assert.deepEqual(r.fields, { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" });
});

test("classifies non-appointment intent", async () => {
  const deps = depsServing(JSON.stringify({ intent: "other", nume: null, telefon: null, dataDorita: null }));
  const r = await extractAppointment("Unde aveți sediul?", FIELDS, "2026-06-12", { classify: true }, deps);
  assert.equal(r.intent, "other");
});

test("uses the primary provider (OpenAI); records its usage", async () => {
  const deps = depsServing(JSON.stringify({ intent: "appointment", nume: "Ana", telefon: null, dataDorita: null }));
  const r = await extractAppointment("Sunt Ana, vreau o programare", FIELDS, "2026-06-12", { classify: true }, deps);
  assert.equal(r.usage?.provider, "openai");
});

test("falls back to the secondary provider when the primary throws", async () => {
  const deps: AppointmentExtractionDeps = {
    primary: { name: "openai", model: "fake", generate: async () => { throw new Error("openai down"); } },
    fallback: fakeProvider("gemini", () => JSON.stringify({ intent: "appointment", nume: "Ion", telefon: null, dataDorita: null })),
    logger: silentLogger,
  };
  const r = await extractAppointment("...", FIELDS, "2026-06-12", { classify: true }, deps);
  assert.equal(r.fields.nume, "Ion");
  assert.equal(r.usage?.provider, "gemini");
});

test("classify:false omits intent from both schemas; intent defaults to appointment; empty strings become null", async () => {
  // Schema shape is built per-provider from the fields, asserted directly.
  assert.ok(!JSON.stringify(buildSchema(FIELDS, false)).includes("intent"));
  assert.ok(!JSON.stringify(buildOpenAiResponseFormat(FIELDS, false)).includes("intent"));
  assert.ok(JSON.stringify(buildSchema(FIELDS, true)).includes("intent"));

  const deps = depsServing(JSON.stringify({ nume: "", telefon: "0722111222", dataDorita: null }));
  const r = await extractAppointment("Telefonul e 0722111222", FIELDS, "2026-06-12", { classify: false }, deps);
  assert.equal(r.intent, "appointment");
  assert.equal(r.fields.telefon, "0722111222");
  assert.equal(r.fields.nume, null);
});

test("field descriptions reach both schemas", () => {
  assert.ok(JSON.stringify(buildSchema(FIELDS, false)).includes("Număr de telefon de contact"));
  assert.ok(JSON.stringify(buildOpenAiResponseFormat(FIELDS, false)).includes("Număr de telefon de contact"));
});

test("OpenAI schema is strict: every property required, nullable as a union", () => {
  const fmt = JSON.parse(JSON.stringify(buildOpenAiResponseFormat(FIELDS, true)));
  const schema = fmt.json_schema.schema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(fmt.json_schema.strict, true);
  assert.deepEqual(schema.required, ["intent", "nume", "telefon", "dataDorita"]);
  assert.deepEqual(schema.properties.nume.type, ["string", "null"]);
});

test("buildAppointmentParts includes today and the email body", () => {
  const parts = buildAppointmentParts("corpul emailului", "2026-06-12");
  const text = (parts[0] as { text: string }).text;
  assert.ok(text.includes("2026-06-12"));
  assert.ok(text.includes("corpul emailului"));
});

test("mergeFields: extracted non-null overwrites; null keeps stored", () => {
  const merged = mergeFields({ nume: "Ion", telefon: null }, { nume: null, telefon: "0722" });
  assert.deepEqual(merged, { nume: "Ion", telefon: "0722" });
});

test("missingRequired lists required fields without values", () => {
  const missing = missingRequired(FIELDS, { nume: "Ion", telefon: null, dataDorita: null });
  assert.deepEqual(missing.map((f) => f.key), ["telefon", "dataDorita"]);
});

test("nextStatus: still-missing → collecting; newly-complete → complete; post-complete → updated", () => {
  assert.equal(nextStatus("collecting", 2), "collecting");
  assert.equal(nextStatus("collecting", 0), "complete");
  assert.equal(nextStatus("complete", 0), "updated");
  assert.equal(nextStatus("updated", 0), "updated");
  // A post-complete message that somehow leaves it missing falls back to collecting.
  assert.equal(nextStatus("complete", 1), "collecting");
});
