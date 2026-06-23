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

export interface ExtractionContext {
  partCode: string | null;
}

// Gemini content parts (the fallback provider's wire format).
export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** A single LLM backend. `generate` returns the raw JSON string + token usage. */
export interface LlmProvider {
  name: "openai" | "gemini";
  model: string;
  generate(source: ExtractionSource, today: string, ctx: ExtractionContext): Promise<{ text: string; usage: LlmUsage }>;
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
  isOffer: boolean;
  price: string | null;
  // True when a part code was requested but the line the model used carries a
  // different one. Values are kept (still useful) but the order is flagged for review.
  partCodeMismatch: boolean;
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
  isOffer: boolean;
  price: string | null;
  // The part code of the line the model used for delivery/price, verbatim from
  // the document. We compare it against the requested code to confirm the match.
  partCode: string | null;
}

// ---- Prompts (loaded once from backend/prompts, outside dist/) ----

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../prompts");
const TEXT_PROMPT = readFileSync(join(PROMPT_DIR, "extraction-text.md"), "utf8");
const BINARY_PROMPT = readFileSync(join(PROMPT_DIR, "extraction-binary.md"), "utf8");

/** The instruction text for a source. For text emails the body is appended. */
function promptText(source: ExtractionSource, today: string, ctx: ExtractionContext): string {
  if (source.kind === "text") {
    return renderTemplate(TEXT_PROMPT, { today, partCode: ctx.partCode ?? "" }) + source.body;
  }
  return renderTemplate(BINARY_PROMPT, { today, partCode: ctx.partCode ?? "" });
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
        isOffer: { type: "boolean" },
        price: { type: ["string", "null"] },
        partCode: { type: ["string", "null"] },
      },
      required: ["orderNumber", "deliveryTime", "deliveryEarliest", "deliveryLatest", "orderNumberQuote", "deliveryQuote", "isOffer", "price", "partCode"],
    },
  },
} as const;

function openaiContent(source: ExtractionSource, today: string, ctx: ExtractionContext): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const text = promptText(source, today, ctx);
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
  async generate(source, today, ctx) {
    const model = this.model;
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [{ role: "user", content: openaiContent(source, today, ctx) }],
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

function geminiParts(source: ExtractionSource, today: string, ctx: ExtractionContext): ContentPart[] {
  const text = promptText(source, today, ctx);
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
  async generate(source, today, ctx) {
    const model = this.model;
    const ai = (geminiClient ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! }));
    const response = await ai.models.generateContent({
      model,
      contents: geminiParts(source, today, ctx),
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
            isOffer: { type: Type.BOOLEAN, nullable: true },
            price: { type: Type.STRING, nullable: true },
            partCode: { type: Type.STRING, nullable: true },
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
  today: string,
  ctx: ExtractionContext
): Promise<{ parsed: ParsedFields; usage: LlmUsage }> {
  try {
    const { text, usage } = await deps.primary.generate(source, today, ctx);
    const parsed = JSON.parse(text) as ParsedFields;
    deps.logger.info({ provider: deps.primary.name, model: deps.primary.model }, "llm extraction");
    return { parsed, usage };
  } catch (err) {
    deps.logger.warn({ provider: deps.primary.name, err }, "llm primary failed; using fallback");
    const { text, usage } = await deps.fallback.generate(source, today, ctx);
    const parsed = JSON.parse(text) as ParsedFields;
    deps.logger.info({ provider: deps.fallback.name, model: deps.fallback.model }, "llm extraction (fallback)");
    return { parsed, usage };
  }
}

/**
 * Normalize Romanian currency wording ("lei"/"ron", any case) to "RON". Prices
 * in another currency (EUR, USD, …) are left exactly as the model returned them.
 */
export function normalizePrice(price: string | null): string | null {
  if (!price) return null;
  return price.replace(/(?<!\p{L})(lei|ron)(?!\p{L})/giu, "RON");
}

/**
 * True when the model's matched part code equals the requested one, ignoring
 * case and non-alphanumeric separators (spaces, dashes, dots) that vendors
 * format inconsistently. A null/empty model code never matches.
 */
export function partCodeMatches(requested: string, found: string | null): boolean {
  if (!found) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const r = norm(requested);
  return r.length > 0 && r === norm(found);
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A relative lead-time expressed in days, e.g. "5-7 zile lucrătoare" or "3 zile".
 * Vendors quote these against the moment they reply, but the model often anchors
 * them to a date printed in the offer (weeks old), yielding past delivery dates.
 * We re-resolve them deterministically against `today` instead.
 */
function parseRelativeDays(text: string): { min: number; max: number; business: boolean } | null {
  // Match "N" or "N-M" before "zile", plus an optional working-day marker. The
  // marker is matched loosely so abbreviations all count as business days:
  // "lucrătoare", "lucratoare", "lucr.", "lucr", "z.l." → weekends excluded.
  const m = text
    .toLowerCase()
    .match(/(\d{1,3})\s*(?:[-–—]\s*(\d{1,3}))?\s*zile(\s*(?:lucr[ăâîșța-z]*\.?|l\.))?/);
  if (!m) return null;
  const min = Number.parseInt(m[1], 10);
  const max = m[2] ? Number.parseInt(m[2], 10) : min;
  if (max < min) return null;
  return { min, max, business: m[3] != null };
}

function addDays(base: Date, n: number, business: boolean): Date {
  const d = new Date(base);
  if (!business) {
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

/**
 * Resolve a relative lead-time phrase ("5-7 zile lucrătoare", "3 zile") into a
 * concrete delivery window counted from `from`. Returns null for absolute or
 * non-day phrases, which keep whatever dates the model produced.
 */
export function resolveRelativeDelivery(
  text: string | null,
  from: Date
): { earliest: Date; latest: Date } | null {
  if (!text) return null;
  const rel = parseRelativeDays(text);
  if (!rel) return null;
  return {
    earliest: addDays(from, rel.min, rel.business),
    latest: addDays(from, rel.max, rel.business),
  };
}

export async function extractOrderInfo(
  source: ExtractionSource,
  today: string,
  ctx: ExtractionContext = { partCode: null },
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const { parsed, usage } = await generateWithFallback(deps, source, today, ctx);

  // When a part code is requested, the model returns the code of the line it used.
  // A different code (or none) means the values may be from the wrong line — keep
  // them but flag the order so the reviewer sees "Număr piesă diferit".
  const partCodeMismatch = !!ctx.partCode && !partCodeMatches(ctx.partCode, parsed.partCode);

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

  // Re-resolve relative lead times ("5-7 zile lucrătoare", "3 zile") against today
  // so a window the model anchored to a stale offer date isn't reported as overdue.
  const relText = parsed.deliveryTime ?? parsed.deliveryQuote;
  const todayDate = parseIsoDate(today);
  if (relText && todayDate) {
    const resolved = resolveRelativeDelivery(relText, todayDate);
    if (resolved) {
      deliveryEarliest = resolved.earliest;
      deliveryLatest = resolved.latest;
      deliveryTime = parsed.deliveryTime ?? relText;
    }
  }

  // Grounding only applies to text — for binary we have no source text to match.
  const body = source.kind === "text" ? source.body : null;
  const orderNumberGrounded = body === null ? true : quoteInBody(parsed.orderNumberQuote, body);
  const deliveryGrounded = body === null ? true : quoteInBody(parsed.deliveryQuote, body);

  const isOffer = parsed.isOffer === true;
  const price = normalizePrice(parsed.price || null);

  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, orderNumberGrounded, deliveryGrounded, status, isOffer, price, partCodeMismatch, usage };
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
  const isOffer = base.isOffer || extra.isOffer;
  const price = base.price ?? extra.price;
  const partCodeMismatch = base.partCodeMismatch || extra.partCodeMismatch;
  const status: ExtractionResult["status"] =
    orderNumber && deliveryEarliest ? "extracted" : "needs_review";
  return { orderNumber, deliveryTime, deliveryEarliest, deliveryLatest, orderNumberGrounded, deliveryGrounded, status, isOffer, price, partCodeMismatch };
}
