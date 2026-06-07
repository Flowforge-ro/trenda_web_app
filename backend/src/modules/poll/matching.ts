import type { GraphMessage } from "../../lib/microsoft.js";

export function normalizeMessageId(raw: string): string {
  return raw.trim().replace(/^<+/, "").replace(/>+$/, "");
}

export function parseReferencedIds(
  headers: { name: string; value: string }[] | undefined
): string[] {
  if (!headers) return [];
  const ids: string[] = [];
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (name !== "in-reply-to" && name !== "references") continue;
    for (const token of h.value.split(/\s+/)) {
      const t = token.trim();
      if (t) ids.push(normalizeMessageId(t));
    }
  }
  return ids;
}

export function matchReply<T extends { internetMessageId: string | null }>(
  message: GraphMessage,
  ordersByMessageId: Map<string, T>
): T | null {
  for (const ref of parseReferencedIds(message.internetMessageHeaders)) {
    const order = ordersByMessageId.get(ref);
    if (order) return order;
  }
  return null;
}
