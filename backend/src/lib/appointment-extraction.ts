import { GoogleGenAI, Type } from "@google/genai";
import type { ContentPart } from "./extraction.js";
import type { LlmUsage } from "./usage.js";

const MODEL = "gemini-3.5-flash";

export interface AppointmentField {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

export interface AppointmentExtraction {
  intent: "appointment" | "other";
  fields: Record<string, string | null>;
  // Token usage of the LLM call (for metering).
  usage?: LlmUsage;
}

/** Schema is per-call (dynamic), so generate receives it explicitly — unlike
 *  extraction.ts where the schema is baked into defaultGenerate. */
export interface AppointmentExtractionDeps {
  generate: (parts: ContentPart[], responseSchema: unknown) => Promise<{ text: string; usage: LlmUsage }>;
}

function buildSchema(fields: AppointmentField[], classify: boolean): unknown {
  const properties: Record<string, unknown> = {};
  if (classify) {
    properties.intent = { type: Type.STRING, enum: ["appointment", "other"] };
  }
  for (const f of fields) {
    properties[f.key] = { type: Type.STRING, nullable: true, description: f.description };
  }
  return { type: Type.OBJECT, properties };
}

export function buildAppointmentParts(body: string, today: string): ContentPart[] {
  const lines = [
    "Ești un asistent care extrage date dintr-un email primit de la un client al unui service auto.",
    `Data de azi este ${today}.`,
    "Extrage doar informațiile cerute de schemă. Nu inventa niciodată valori.",
    "Pentru date calendaristice returnează format ISO YYYY-MM-DD, rezolvând expresii vagi față de data de azi.",
    "Dacă o valoare lipsește, returnează null pentru ea.",
    'Dacă schema cere "intent": răspunde "appointment" dacă clientul vrea o programare, altfel "other".',
    "",
    "Conținutul emailului:",
    body,
  ];
  return [{ text: lines.join("\n") }];
}

async function defaultGenerate(parts: ContentPart[], responseSchema: unknown): Promise<{ text: string; usage: LlmUsage }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: { responseMimeType: "application/json", responseSchema: responseSchema as never },
  });
  return {
    text: response.text ?? "",
    usage: {
      provider: "gemini",
      model: MODEL,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

const defaultDeps: AppointmentExtractionDeps = { generate: defaultGenerate };

export async function extractAppointment(
  body: string,
  fields: AppointmentField[],
  today: string,
  opts: { classify: boolean },
  deps: AppointmentExtractionDeps = defaultDeps
): Promise<AppointmentExtraction> {
  const { text, usage } = await deps.generate(buildAppointmentParts(body, today), buildSchema(fields, opts.classify));
  const parsed = JSON.parse(text) as Record<string, unknown>;

  const intent: AppointmentExtraction["intent"] =
    opts.classify && parsed.intent === "other" ? "other" : "appointment";

  const out: Record<string, string | null> = {};
  for (const f of fields) {
    const v = parsed[f.key];
    out[f.key] = typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return { intent, fields: out, usage };
}

/** Merge: extracted non-null values overwrite stored ones (corrections win). */
export function mergeFields(
  stored: Record<string, string | null>,
  extracted: Record<string, string | null>
): Record<string, string | null> {
  const merged = { ...stored };
  for (const [k, v] of Object.entries(extracted)) {
    if (v !== null) merged[k] = v;
  }
  return merged;
}

export function missingRequired(
  fields: AppointmentField[],
  values: Record<string, string | null>
): AppointmentField[] {
  return fields.filter((f) => f.required && !values[f.key]);
}
