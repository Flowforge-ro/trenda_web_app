import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";
import { apiFetch } from "./http";
import { logAction } from "./logger";

export interface Order {
  id: string;
  vendorEmail: string;
  chassisSeries: string;
  partCode: string;
  status: string;
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  replyStatus: string;
  emailStatus: string;
  closedAt: string | null;
  createdAt: string;
  registrationNumber: string | null;
  offerPrice: string | null;
}

export interface NewOrderPayload {
  vendorEmail: string;
  chassisSeries: string;
  partCode: string;
  mailboxId: string;
  registrationNumber?: string;
}

interface CreateOrderResult {
  order: Order;
  emailSent: boolean;
}

async function createOrder(payload: NewOrderPayload): Promise<CreateOrderResult> {
  const res = await apiFetch("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea comenzii a eșuat");
  return res.json();
}

const ORDERS_PAGE_SIZE = 50;

interface OrdersPage {
  orders: Order[];
  nextCursor: string | null;
}

async function fetchOrders(cursor?: string): Promise<OrdersPage> {
  const params = new URLSearchParams({ limit: String(ORDERS_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch(`/orders?${params}`);
  if (!res.ok) throw new Error("Nu s-au putut încărca comenzile");
  return res.json();
}

export function useOrders() {
  return useInfiniteQuery({
    queryKey: ["orders"],
    queryFn: ({ pageParam }) => fetchOrders(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

async function resendOrder(id: string): Promise<CreateOrderResult> {
  const res = await apiFetch(`/orders/${id}/resend`, { method: "POST" });
  if (!res.ok) throw new Error("Retrimiterea emailului a eșuat");
  return res.json();
}

export function useResendOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resendOrder,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.resend", { orderId: data.order.id, emailSent: data.emailSent });
    },
  });
}

async function closeOrder(id: string): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${id}/close`, { method: "POST" });
  if (!res.ok) throw new Error("Închiderea comenzii a eșuat");
  return res.json();
}

export function useCloseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeOrder,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.close", { orderId: data.order.id });
    },
  });
}

function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso);
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000);
}

/** Human countdown to delivery, in Romanian. Returns "—" when no dates are known. */
export function formatDeliveryCountdown(
  earliest: string | null,
  latest: string | null,
  now: Date = new Date()
): string {
  if (!earliest || !latest) return "—";
  const de = daysUntil(earliest, now);
  const dl = daysUntil(latest, now);
  if (de === dl) {
    if (de < 0) return "întârziat";
    if (de === 0) return "azi";
    if (de === 1) return "mâine";
    return `${de} zile`;
  }
  if (dl < 0) return "întârziat";
  return `în ${Math.max(de, 0)}–${dl} zile`;
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOrder,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.create", { orderId: data.order.id, emailSent: data.emailSent });
    },
  });
}

export interface ReviewAttachment {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

export interface OrderReview {
  reply: {
    fromEmail: string;
    subject: string | null;
    receivedDateTime: string;
    body: string | null;
  };
  attachments: ReviewAttachment[];
  current: {
    orderNumber: string | null;
    deliveryTime: string | null;
    deliveryEarliest: string | null;
    deliveryLatest: string | null;
  };
  confidence: {
    orderNumber: "high" | "low";
    delivery: "high" | "low";
  };
  reasons: string[];
}

export interface SaveReviewPayload {
  orderNumber?: string | null;
  deliveryEarliest?: string | null;
  deliveryLatest?: string | null;
}

async function fetchOrderReview(id: string): Promise<OrderReview> {
  const res = await apiFetch(`/orders/${id}/review`);
  if (!res.ok) throw new Error("Nu s-a putut încărca răspunsul");
  return res.json();
}

export function useOrderReview(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["order-review", id],
    queryFn: () => fetchOrderReview(id),
    enabled,
  });
}

export function attachmentUrl(orderId: string, attachmentId: string): string {
  // Graph attachment ids can contain URL-special chars; encode the path segment.
  return `${API_BASE}/orders/${orderId}/attachments/${encodeURIComponent(attachmentId)}`;
}

async function saveReview(args: { id: string; payload: SaveReviewPayload }): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${args.id}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.payload),
  });
  if (!res.ok) throw new Error("Salvarea a eșuat");
  return res.json();
}

async function acceptOffer(id: string): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${id}/accept-offer`, { method: "POST" });
  if (!res.ok) throw new Error("Acceptarea ofertei a eșuat");
  return res.json();
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptOffer,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.offer.accept", { orderId: data.order.id });
    },
  });
}

async function rejectOffer(id: string): Promise<{ order: Order }> {
  const res = await apiFetch(`/orders/${id}/reject-offer`, { method: "POST" });
  if (!res.ok) throw new Error("Respingerea ofertei a eșuat");
  return res.json();
}

export function useRejectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectOffer,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      logAction("order.offer.reject", { orderId: data.order.id });
    },
  });
}

export function useSaveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveReview,
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-review", id] });
      logAction("order.review.save", { orderId: id });
    },
  });
}
