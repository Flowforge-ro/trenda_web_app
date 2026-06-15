import { z } from "zod";

const hex64 = (name: string) =>
  z.string({ error: `${name} is required` }).regex(/^[0-9a-fA-F]{64}$/, `${name} must be a 64-char hex string (32 bytes)`);

// Everything the app reads from the environment, validated in one place.
// server.ts calls validateEnv() BEFORE importing app.ts, so a missing or
// malformed variable fails the boot with a named error instead of surfacing
// later as a cryptic crash (or, worse, a silently short session key).
const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: hex64("SESSION_SECRET"),
  ENCRYPTION_KEY: hex64("ENCRYPTION_KEY"),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET_VALUE: z.string().min(1),
  ENTRA_TENANT_ID: z.string().min(1),
  MICROSOFT_REDIRECT_URI: z.url(),
  MICROSOFT_SCOPES: z.string().min(1),
  // LLM extraction: OpenAI is the primary provider, Gemini the fallback.
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o"),
  GOOGLE_LLM_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  FRONTEND_ORIGIN: z.url().optional(),
  POLL_INTERVAL_MS: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }
  return parsed.data;
}
