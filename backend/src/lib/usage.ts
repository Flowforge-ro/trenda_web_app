import { prisma } from "../prisma.js";
import { logger } from "./logger.js";

export interface LlmUsage {
  provider: "openai" | "gemini";
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// Estimated prices in USD per 1M tokens. Maintain as provider prices change;
// an unknown model falls back to 0 (cost shows as an underestimate, never crashes).
const PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-5.4-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-3.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}

export interface UsageEventInput {
  orgId: string;
  kind: "llm" | "email_read" | "email_write" | "classification";
  provider?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  emails?: number;
  outcome?: string | null;
}

export interface UsageDeps {
  prisma: typeof prisma;
}
const defaultDeps: UsageDeps = { prisma };

/** Best-effort: a metering failure must never break a poll cycle or a request. */
export async function recordUsage(event: UsageEventInput, deps: UsageDeps = defaultDeps): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    await deps.prisma.usageEvent.create({
      data: {
        orgId: event.orgId,
        kind: event.kind,
        provider: event.provider ?? null,
        model: event.model ?? null,
        promptTokens: event.promptTokens ?? 0,
        completionTokens: event.completionTokens ?? 0,
        costUsd: event.costUsd ?? 0,
        emails: event.emails ?? 0,
        outcome: event.outcome ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to record usage event");
  }
}

/** Function shape of recordUsage, so callers can inject a test/DI fake. */
export type RecordUsageFn = (event: UsageEventInput) => Promise<void>;

/** Record an LLM call's token usage + estimated cost for an org. Best-effort. */
export async function recordLlmUsage(
  orgId: string,
  usage: LlmUsage | undefined,
  record: RecordUsageFn = recordUsage,
): Promise<void> {
  if (!usage) return;
  await record({
    orgId,
    kind: "llm",
    provider: usage.provider,
    model: usage.model,
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens),
  });
}
