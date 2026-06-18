import type { prisma } from "../../prisma.js";
import type { decrypt, encrypt } from "../../lib/crypto.js";
import type { getAccessTokenFromRefreshToken, listMessagesSince, createAndSendMail, listFileAttachments } from "../../lib/microsoft.js";
import type { ExtractionContext, ExtractionResult, ExtractionSource } from "../../lib/extraction.js";
import type { recordUsage } from "../../lib/usage.js";

export interface PollDeps {
  prisma: typeof prisma;
  decrypt: typeof decrypt;
  encrypt: typeof encrypt;
  getAccessTokenFromRefreshToken: typeof getAccessTokenFromRefreshToken;
  listMessagesSince: typeof listMessagesSince;
  createAndSendMail: typeof createAndSendMail;
  extractOrderInfo: (source: ExtractionSource, today: string, ctx: ExtractionContext) => Promise<ExtractionResult>;
  listFileAttachments: typeof listFileAttachments;
  recordUsage: typeof recordUsage;
  now: () => Date;
}

/** Lazily resolves (and caches) one access token per mailbox per poll cycle. */
export type GetToken = (mailboxId: string) => Promise<string | null>;
