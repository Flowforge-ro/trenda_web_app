import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAppointment,
  buildAppointmentParts,
  mergeFields,
  missingRequired,
  type AppointmentField,
  type AppointmentExtractionDeps,
} from "./appointment-extraction.js";

const FIELDS: AppointmentField[] = [
  { key: "nume", label: "Nume", description: "Numele complet al clientului", required: true },
  { key: "telefon", label: "Telefon", description: "Număr de telefon de contact", required: true },
  { key: "dataDorita", label: "Data dorită", description: "Data programării, ISO YYYY-MM-DD; rezolvă expresii vagi față de azi", required: true },
];

test("classifies appointment and extracts fields", async () => {
  const generate: AppointmentExtractionDeps["generate"] = async () =>
    JSON.stringify({ intent: "appointment", nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" });
  const r = await extractAppointment("Bună, vreau o programare pe 20 iunie. Ion Pop", FIELDS, "2026-06-12", { classify: true }, { generate });
  assert.equal(r.intent, "appointment");
  assert.deepEqual(r.fields, { nume: "Ion Pop", telefon: null, dataDorita: "2026-06-20" });
});

test("classifies non-appointment intent", async () => {
  const generate: AppointmentExtractionDeps["generate"] = async () => JSON.stringify({ intent: "other", nume: null, telefon: null, dataDorita: null });
  const r = await extractAppointment("Unde aveți sediul?", FIELDS, "2026-06-12", { classify: true }, { generate });
  assert.equal(r.intent, "other");
});

test("classify:false omits intent from schema and defaults intent to appointment", async () => {
  let captured: unknown;
  const generate: AppointmentExtractionDeps["generate"] = async (_parts, schema) => {
    captured = schema;
    return JSON.stringify({ nume: null, telefon: "0722111222", dataDorita: null });
  };
  const r = await extractAppointment("Telefonul e 0722111222", FIELDS, "2026-06-12", { classify: false }, { generate });
  assert.equal(r.intent, "appointment");
  assert.equal(r.fields.telefon, "0722111222");
  assert.ok(!JSON.stringify(captured).includes("intent"));
});

test("field descriptions reach the schema; empty strings become null", async () => {
  let captured = "";
  const generate: AppointmentExtractionDeps["generate"] = async (_parts, schema) => {
    captured = JSON.stringify(schema);
    return JSON.stringify({ nume: "", telefon: null, dataDorita: null });
  };
  const r = await extractAppointment("...", FIELDS, "2026-06-12", { classify: false }, { generate });
  assert.ok(captured.includes("Număr de telefon de contact"));
  assert.equal(r.fields.nume, null);
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
