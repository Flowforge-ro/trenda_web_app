import { useQuery } from "@tanstack/react-query";
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
