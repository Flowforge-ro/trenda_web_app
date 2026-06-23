import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { logger as defaultLogger } from "./logger.js";
import { logEvent, type EventIds } from "./db-log.js";
import { getOpenAI, withTimeout, sleep, errMessage, LLM_TIMEOUT_MS, LLM_MAX_ATTEMPTS, LLM_RETRY_BASE_MS, type ContentPart, type ExtractionLogger } from "./extraction.js";
import type { LlmUsage } from "./usage.js";

// Models are configurable via .env (OPENAI_MODEL / GEMINI_MODEL), shared with
// the order extractor; these are the fallback defaults when unset.
const OPENAI_MODEL_DEFAULT = "gpt-5.4-mini";
const GEMINI_MODEL_DEFAULT = "gemini-3.5-flash";

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

/** A single LLM backend for appointment extraction. The schema is dynamic
 *  (per-org fields), so each provider builds its own wire-format schema from
 *  `fields`/`classify` — mirroring the order extractor in extraction.ts. */
export interface AppointmentLlmProvider {
  name: "openai" | "gemini";
  model: string;
  generate(
    parts: ContentPart[],
    fields: AppointmentField[],
    classify: boolean
  ): Promise<{ text: string; usage: LlmUsage }>;
}

export interface AppointmentExtractionDeps {
  primary: AppointmentLlmProvider;
  fallback: AppointmentLlmProvider;
  logger: ExtractionLogger;
}

/** Gemini response schema (Type.OBJECT) built from the org's fields. */
export function buildSchema(fields: AppointmentField[], classify: boolean): unknown {
  const properties: Record<string, unknown> = {};
  if (classify) {
    properties.intent = { type: Type.STRING, enum: ["appointment", "other"] };
  }
  for (const f of fields) {
    properties[f.key] = { type: Type.STRING, nullable: true, description: f.description };
  }
  return { type: Type.OBJECT, properties };
}

/** OpenAI strict structured-output schema built from the org's fields:
 *  every property required, nullables expressed as a ["string","null"] union. */
export function buildOpenAiResponseFormat(fields: AppointmentField[], classify: boolean) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (classify) {
    properties.intent = { type: "string", enum: ["appointment", "other"] };
    required.push("intent");
  }
  for (const f of fields) {
    properties[f.key] = { type: ["string", "null"], description: f.description };
    required.push(f.key);
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "appointment_extraction",
      strict: true,
      schema: { type: "object", additionalProperties: false, properties, required },
    },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
}

// ---- OpenAI (primary) ----

const openaiProvider: AppointmentLlmProvider = {
  name: "openai",
  get model() {
    return process.env.OPENAI_MODEL ?? OPENAI_MODEL_DEFAULT;
  },
  async generate(parts, fields, classify) {
    const model = this.model;
    const content = parts
      .filter((p): p is { text: string } => "text" in p)
      .map((p) => ({ type: "text" as const, text: p.text }));
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      response_format: buildOpenAiResponseFormat(fields, classify),
    });
    return {
      text: response.choices[0]?.message?.content ?? "",
      usage: {
        provider: "openai",
        model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },
};

// ---- Gemini (fallback) ----

let geminiClient: GoogleGenAI | null = null;
const geminiProvider: AppointmentLlmProvider = {
  name: "gemini",
  get model() {
    return process.env.GEMINI_MODEL ?? GEMINI_MODEL_DEFAULT;
  },
  async generate(parts, fields, classify) {
    const model = this.model;
    const ai = (geminiClient ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! }));
    const response = await ai.models.generateContent({
      model,
      contents: parts,
      config: { responseMimeType: "application/json", responseSchema: buildSchema(fields, classify) as never },
    });
    return {
      text: response.text ?? "",
      usage: {
        provider: "gemini",
        model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  },
};

const defaultDeps: AppointmentExtractionDeps = {
  primary: openaiProvider,
  fallback: geminiProvider,
  logger: defaultLogger,
};

/** One appointment provider call: request log → timed generate → response log → parse. */
async function runApptProvider(
  deps: AppointmentExtractionDeps,
  provider: AppointmentLlmProvider,
  parts: ContentPart[],
  fields: AppointmentField[],
  classify: boolean,
  prompt: string,
  ids: EventIds,
  fallback: boolean
): Promise<{ parsed: Record<string, unknown>; usage: LlmUsage }> {
  const tag = fallback ? { fallback: true } : {};
  logEvent("appt.llm.request", { provider: provider.name, model: provider.model, classify, ...tag, prompt }, ids);
  const { text, usage } = await withTimeout(provider.generate(parts, fields, classify), LLM_TIMEOUT_MS, provider.name);
  logEvent("appt.llm.response", { provider: provider.name, model: provider.model, classify, ...tag, response: text, usage }, ids);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  deps.logger.info({ provider: provider.name, model: provider.model }, fallback ? "appointment extraction (fallback)" : "appointment extraction");
  return { parsed, usage };
}

/** Try primary; fall back to secondary; retry the pair with backoff when BOTH
 *  fail (transient throttling/503). Mirrors extraction.ts:generateWithFallback. */
async function generateWithFallback(
  deps: AppointmentExtractionDeps,
  parts: ContentPart[],
  fields: AppointmentField[],
  classify: boolean,
  ids: EventIds = {}
): Promise<{ parsed: Record<string, unknown>; usage: LlmUsage }> {
  const prompt = parts.map((p) => ("text" in p ? p.text : `<binary ${p.inlineData.mimeType}>`)).join("\n");
  let lastErr: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    try {
      return await runApptProvider(deps, deps.primary, parts, fields, classify, prompt, ids, false);
    } catch (errPrimary) {
      deps.logger.warn({ provider: deps.primary.name, err: errPrimary }, "appointment llm primary failed; using fallback");
      logEvent("appt.llm.error", { provider: deps.primary.name, model: deps.primary.model, attempt, error: errMessage(errPrimary) }, ids);
      try {
        return await runApptProvider(deps, deps.fallback, parts, fields, classify, prompt, ids, true);
      } catch (errFallback) {
        lastErr = errFallback;
        deps.logger.warn({ provider: deps.fallback.name, err: errFallback, attempt }, "appointment llm fallback failed");
        logEvent("appt.llm.error", { provider: deps.fallback.name, model: deps.fallback.model, attempt, fallback: true, error: errMessage(errFallback) }, ids);
        if (attempt < LLM_MAX_ATTEMPTS) await sleep(LLM_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
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

export async function extractAppointment(
  body: string,
  fields: AppointmentField[],
  today: string,
  opts: { classify: boolean; correlationId?: string | null; orgId?: string | null },
  deps: AppointmentExtractionDeps = defaultDeps
): Promise<AppointmentExtraction> {
  const { parsed, usage } = await generateWithFallback(
    deps,
    buildAppointmentParts(body, today),
    fields,
    opts.classify,
    { correlationId: opts.correlationId, orgId: opts.orgId }
  );

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
