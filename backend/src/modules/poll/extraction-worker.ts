import { mergeMissing, type ExtractionResult } from "../../lib/extraction.js";
import { scoreConfidence, needsReview } from "../../lib/confidence.js";
import { recordLlmUsage } from "../../lib/usage.js";
import { VENDOR_COMMUNICATION } from "../../features/registry.js";
import { logError, logEvent } from "../../lib/db-log.js";
import { logger } from "../../lib/logger.js";
import type { Order } from "../../generated/prisma/client.js";
import type { PollDeps, GetToken } from "./poll.types.js";

type PendingOrder = Pick<Order, "id" | "orgId" | "mailboxId" | "orderNumber" | "deliveryTime" | "deliveryEarliest" | "deliveryLatest" | "partCode">;

/** Extract delivery/order info for every order sitting at "reply_received". */
export async function extractPending(deps: PollDeps, getToken: GetToken): Promise<void> {
  const pending = (await deps.prisma.order.findMany({
    where: { replyStatus: "reply_received", closedAt: null, org: { suspendedAt: null } },
    select: { id: true, orgId: true, mailboxId: true, orderNumber: true, deliveryTime: true, deliveryEarliest: true, deliveryLatest: true, partCode: true },
  }));
  if (pending.length === 0) return;

  for (const order of pending) {
    try {
      await extractForOrder(order, getToken, deps);
    } catch (err) {
      // A hard failure leaves the order at "reply_received" so the next poll retries it.
      logError("Extraction failed for order", err, { orderId: order.id });
    }
  }
}

/** Canonical Gemini mime for a supported attachment (PDF/JPEG/PNG), or null. */
function supportedMime(att: { name: string; contentType: string | null }): string | null {
  const ct = att.contentType?.toLowerCase() ?? "";
  const name = att.name.toLowerCase();
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (ct === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (ct === "image/png" || name.endsWith(".png")) return "image/png";
  return null;
}

async function extractForOrder(order: PendingOrder, getToken: GetToken, deps: PollDeps): Promise<void> {
  const reply = await deps.prisma.orderReply.findFirst({
    where: { orderId: order.id },
    orderBy: { receivedDateTime: "desc" },
    select: { body: true, graphMessageId: true, hasAttachments: true },
  });

  const today = deps.now().toISOString().slice(0, 10);
  if (reply?.body) {
    logger.info(
      {
        sentAt: new Date().toISOString(),
        mode: "order-extract",
        orderId: order.id,
        graphMessageId: reply.graphMessageId,
        hasAttachments: reply.hasAttachments,
        bodyChars: reply.body.length,
      },
      "llm-send: order extract"
    );
  }
  const llmCtx = { partCode: order.partCode, correlationId: order.id, orgId: order.orgId };
  let result: ExtractionResult = reply?.body
    ? await deps.extractOrderInfo({ kind: "text", body: reply.body }, today, llmCtx)
    : { orderNumber: null, deliveryTime: null, deliveryEarliest: null, deliveryLatest: null, orderNumberGrounded: true, deliveryGrounded: true, status: "needs_review", isOffer: false, price: null, partCodeMismatch: false };

  await recordLlmUsage(order.orgId, result.usage, deps.recordUsage, VENDOR_COMMUNICATION);

  // The token is only needed for attachment fallback; fetch it lazily so a
  // text-only extraction never costs a refresh, and a failed refresh still
  // lets the text extraction result land.
  let accessToken: string | null = null;
  if (result.status !== "extracted" && reply?.hasAttachments && reply.graphMessageId) {
    try {
      accessToken = await getToken(order.mailboxId);
    } catch (err) {
      logError("Token refresh failed for mailbox", err, { mailboxId: order.mailboxId });
    }
  }

  if (result.status !== "extracted" && reply?.hasAttachments && accessToken && reply.graphMessageId) {
    const atts = await deps.listFileAttachments(accessToken, reply.graphMessageId);
    const sources = atts
      .map((a) => ({ a, mime: supportedMime(a) }))
      .filter((x) => x.mime !== null)
      .sort((x, y) => Number(y.mime === "application/pdf") - Number(x.mime === "application/pdf"));
    for (const { a, mime } of sources) {
      logEvent("extract.attachment", { name: a.name, mimeType: mime, byteSize: a.bytes.byteLength }, { correlationId: order.id, orgId: order.orgId });
      const attResult = await deps.extractOrderInfo({ kind: "binary", bytes: a.bytes, mimeType: mime! }, today, llmCtx);
      await recordLlmUsage(order.orgId, attResult.usage, deps.recordUsage, VENDOR_COMMUNICATION);
      result = mergeMissing(result, attResult);
      if (result.status === "extracted") break;
    }
  }

  // A correction reply may restate only the changed field (e.g. a new delivery
  // date); keep previously extracted values for anything it omits.
  result = mergeMissing(result, {
    orderNumber: order.orderNumber,
    deliveryTime: order.deliveryTime,
    deliveryEarliest: order.deliveryEarliest,
    deliveryLatest: order.deliveryLatest,
    orderNumberGrounded: true,
    deliveryGrounded: true,
    status: "needs_review",
    isOffer: false,
    price: null,
    partCodeMismatch: false,
  });

  // A changed delivery date re-arms the one-time "Status?" nudge.
  const dateChanged =
    (result.deliveryEarliest?.getTime() ?? null) !== (order.deliveryEarliest?.getTime() ?? null);

  // Deterministic per-field confidence gates the auto-extracted status: a present
  // but implausible or ungrounded value still goes to human review.
  const confidence = scoreConfidence(result, today);

  const baseData = {
    orderNumber: result.orderNumber,
    deliveryTime: result.deliveryTime,
    deliveryEarliest: result.deliveryEarliest,
    deliveryLatest: result.deliveryLatest,
    orderNumberConfidence: confidence.orderNumber,
    deliveryConfidence: confidence.delivery,
    reviewReasons: confidence.reasons.length ? confidence.reasons.join("\n") : null,
  };

  const ids = { correlationId: order.id, orgId: order.orgId };
  logEvent("extract.result", {
    orderId: order.id,
    orderNumber: result.orderNumber,
    deliveryTime: result.deliveryTime,
    deliveryEarliest: result.deliveryEarliest,
    deliveryLatest: result.deliveryLatest,
    isOffer: result.isOffer,
    price: result.price,
    partCodeMismatch: result.partCodeMismatch,
    status: result.status,
    confidence,
    dateChanged,
  }, ids);

  const newReplyStatus = result.isOffer
    ? "offer_pending"
    : needsReview(confidence)
      ? "needs_review"
      : "extracted";

  await deps.prisma.order.update({
    where: { id: order.id },
    data: result.isOffer
      ? { ...baseData, offerPrice: result.price, replyStatus: "offer_pending" }
      : {
          ...baseData,
          replyStatus: needsReview(confidence) ? "needs_review" : "extracted",
          ...(dateChanged ? { statusRequestSentAt: null } : {}),
        },
  });

  logEvent("db.write", { table: "order", op: "update", orderId: order.id, replyStatus: newReplyStatus, offerPrice: result.isOffer ? result.price : undefined }, ids);
}
