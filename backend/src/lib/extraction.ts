import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { logger as defaultLogger } from "./logger.js";
import { renderTemplate } from "./template.js";
import { quoteInBody } from "./confidence.js";
import type { LlmUsage } from "./usage.js";

export type ExtractionSource =
  | { kind: "text"; body: string }
  | { kind: "binary"; bytes: Uint8Array; mimeType: string };

// Gemini content parts (the fallback provider's wire format).
export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** A single LLM backend. `generate` returns the raw JSON string + token usage. */
export interface LlmProvider {
  name: "openai" | "gemini";
  model: string;
  generate(source: ExtractionSource, today: string): Promise<{ text: string; usage: LlmUsage }>;
}

/** Minimal logger surface; the real pino logger satisfies it. */
export interface ExtractionLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface ExtractionDeps {
  primary: LlmProvider;
  fallback: LlmProvider;
  logger: ExtractionLogger;
}

export interface ExtractionResult {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: Date | null;
  deliveryLatest: Date | null;
  // Grounding: the value's source span was found verbatim in the email body.
  // Always true for binary sources (no in-code text to match against).
  orderNumberGrounded: boolean;
  deliveryGrounded: boolean;
  status: "extracted" | "needs_review";
  // Token usage of the LLM call that produced this result (for metering).
  usage?: LlmUsage;
}

interface ParsedFields {
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  // Verbatim source spans the model claims it extracted each value from.
  orderNumberQuote: string | null;
  deliveryQuote: string | null;
}

// ---- Prompts (loaded once from backend/prompts, outside dist/) ----

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../prompts");
const TEXT_PROMPT = readFileSync(join(PROMPT_DIR, "extraction-text.md"), "utf8");
const BINARY_PROMPT = readFileSync(join(PROMPT_DIR, "extraction-binary.md"), "utf8");

/** The instruction text for a source. For text emails the body is appended. */
function promptText(source: ExtractionSource, today: string): string {
  if (source.kind === "text") {
    return renderTemplate(TEXT_PROMPT, { today }) + source.body;
  }
  return renderTemplate(BINARY_PROMPT, { today });
}

// ---- OpenAI (primary) ----

// Strict structured-output schema: every field required, nullables as a union.
const OPENAI_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "order_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        orderNumber: { type: ["string", "null"] },
        deliveryTime: { type: ["string", "null"] },
        deliveryEarliest: { type: ["string", "null"] },
        deliveryLatest: { type: ["string", "null"] },
        orderNumberQuote: { type: ["string", "null"] },
        deliveryQuote: { type: ["string", "null"] },
      },
      required: ["orderNumber", "deliveryTime", "deliveryEarliest", "deliveryLatest", "orderNumberQuote", "deliveryQuote"],
    },
  },
} as const;

function openaiContent(source: ExtractionSource, today: string): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const text = promptText(source, today);
  if (source.kind === "text") {
    return [{ type: "text", text }];
  }
  const dataUrl = `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString("base64")}`;
  if (source.mimeType === "application/pdf") {
    return [
      { type: "text", text },
      { type: "file", file: { filename: "attachment.pdf", file_data: dataUrl } },
    ];
  }
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

let openaiClient: OpenAI | null = null;
/** Lazily-initialised shared OpenAI client (reused by appointment-extraction). */
export function getOpenAI(): OpenAI {
  return (openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

const openaiProvider: LlmProvider = {
  name: "openai",
  get model() {
    return process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  },
  async generate(source, today) {
    const model = this.model;
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [{ role: "user", content: openaiContent(source, today) }],
      response_format: OPENAI_RESPONSE_FORMAT,
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

function geminiParts(source: ExtractionSource, today: string): ContentPart[] {
  const text = promptText(source, today);
  if (source.kind === "text") {
    return [{ text }];
  }
  return [
    { text },
    { inlineData: { mimeType: source.mimeType, data: Buffer.from(source.bytes).toString("base64") } },
  ];
}

let geminiClient: GoogleGenAI | null = null;
const geminiProvider: LlmProvider = {
  name: "gemini",
  get model() {
    return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  },
  async generate(source, today) {
    const model = this.model;
    const ai = (geminiClient ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! }));
    const response = await ai.models.generateContent({
      model,
      contents: geminiParts(source, today),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            orderNumber: { type: Type.STRING, nullable: true },
            deliveryTime: { type: Type.STRING, nullable: true },
            deliveryEarliest: { type: Type.STRING, nullable: true },
            deliveryLatest: { type: Type.STRING, nullable: true },
            orderNumberQuote: { type: Type.STRING, nullable: true },
            deliveryQuote: { type: Type.STRING, nullable: true },
          },
        },
      },
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

const defaultDeps: ExtractionDeps = {
  primary: openaiProvider,
  fallback: geminiProvider,
  logger: defaultLogger,
};

/**
 * Run the primary provider; on any thrown error or empty/unparseable response,
 * fall back to the secondary provider. Logs which provider served the result.
 */
async function generateWithFallback(
  deps: ExtractionDeps,
  source: ExtractionSource,
  today: string
): Promise<{ parsed: ParsedFields; usage: LlmUsage }> {
  try {
    const { text, usage } = await deps.primary.generate(source, today);
    const parsed = JSON.parse(text) as ParsedFields;
    deps.logger.info({ provider: deps.primary.name, model: deps.primary.model }, "llm extraction");
    return { parsed, usage };
  } catch (err) {
    deps.logger.warn({ provider: deps.primary.name, err }, "llm primary failed; using fallback");
    const { text, usage } = await deps.fallback.generate(source, today);
    const parsed = JSON.parse(text) as ParsedFields;
    deps.logger.info({ provider: deps.fallback.name, model: deps.fallback.model }, "llm extraction (fallback)");
    return { parsed, usage };
  }
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractOrderInfo(
  source: ExtractionSource,
  today: string,
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const { parsed, usage } = await generateWithFallback(deps, source, today);

  const orderNumber = parsed.orderNumber || null;

  let deliveryTime: string | null = null;
  let deliveryEarliest: Date | null = null;
  let deliveryLatest: Date | null = null;
  if (parsed.deliveryEarliest && parsed.deliveryLatest) {
    const earliest = parseIsoDate(parsed.deliveryEarliest);
    const latest = parseIsoDate(parsed.deliveryLatest);
    if (earliest && latest) {
      deliveryEarliest = earliest;
      deliveryLatest = latest;
      deliveryTime = parsed.deliveryTime;
    }
  }

  // Grounding only applies to text — for binary we have no source text to match.
  const body = source.kind === "text" ? source.body : null;
  const orderNumberGrounded = body === null ? true : quoteInBody(parsed.orderNumberQuote, body);
  const deliveryGrounded = body === null ? true : quoteInBody(parsed.deliveryQuote, body);

  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, orderNumberGrounded, deliveryGrounded, status, usage };
}

export function mergeMissing(
  base: ExtractionResult,
  extra: ExtractionResult
): ExtractionResult {
  const orderNumber = base.orderNumber ?? extra.orderNumber;
  const orderNumberGrounded = base.orderNumber ? base.orderNumberGrounded : extra.orderNumberGrounded;
  let { deliveryTime, deliveryEarliest, deliveryLatest, deliveryGrounded } = base;
  if (deliveryEarliest === null && extra.deliveryEarliest !== null) {
    deliveryTime = extra.deliveryTime;
    deliveryEarliest = extra.deliveryEarliest;
    deliveryLatest = extra.deliveryLatest;
    deliveryGrounded = extra.deliveryGrounded;
  }
  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, orderNumberGrounded, deliveryGrounded, status };
}
