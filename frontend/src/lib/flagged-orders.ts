import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "./api";
import { apiFetch } from "./http";

export interface FlaggedReply {
  fromEmail: string;
  subject: string | null;
  body: string | null;
  receivedDateTime: string;
  hasAttachments: boolean;
}

export interface FlaggedOrder {
  id: string;
  orderNumber: string | null;
  partCode: string;
  chassisSeries: string;
  registrationNumber: string | null;
  vendorEmail: string;
  offerPrice: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  status: string;
  replyStatus: string;
  orderNumberConfidence: string | null;
  deliveryConfidence: string | null;
  reviewReasons: string | null;
  flaggedAt: string;
  flagReason: string | null;
  org: { id: string; name: string };
  flaggedBy: { id: string; email: string; name: string | null } | null;
  replies: FlaggedReply[];
}

async function fetchFlaggedOrders(): Promise<FlaggedOrder[]> {
  const res = await apiFetch("/organizations/flagged-orders");
  if (!res.ok) throw new Error("Nu s-au putut încărca comenzile semnalate");
  const body = (await res.json()) as { orders: FlaggedOrder[] };
  return body.orders;
}

export function useFlaggedOrders() {
  return useQuery({ queryKey: ["flagged-orders"], queryFn: fetchFlaggedOrders });
}

export interface FlaggedAttachment {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

async function fetchFlaggedOrderAttachments(orderId: string): Promise<FlaggedAttachment[]> {
  const res = await apiFetch(`/organizations/flagged-orders/${orderId}/attachments`);
  if (!res.ok) throw new Error("Nu s-au putut încărca atașamentele");
  const body = (await res.json()) as { attachments: FlaggedAttachment[] };
  return body.attachments;
}

export function useFlaggedOrderAttachments(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["flagged-order-attachments", orderId],
    queryFn: () => fetchFlaggedOrderAttachments(orderId),
    enabled,
  });
}

export function flaggedAttachmentUrl(orderId: string, attachmentId: string): string {
  // Graph attachment ids contain '/', '+', '='; pass the id as a query param so
  // an encoded slash in a path segment doesn't 404 (same pattern as orders).
  return `${API_BASE}/organizations/flagged-orders/${orderId}/attachment?attachmentId=${encodeURIComponent(attachmentId)}`;
}
