import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./api";

export interface Order {
  id: string;
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
  status: string;
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  replyStatus: string;
  emailStatus: string;
  createdAt: string;
}

export interface NewOrderPayload {
  emailFurnizor: string;
  serieSasiu: string;
  piesa: string;
}

interface CreateOrderResult {
  order: Order;
  emailSent: boolean;
}

async function createOrder(payload: NewOrderPayload): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea comenzii a eșuat");
  return res.json();
}

async function fetchOrders(): Promise<Order[]> {
  const res = await fetch(`${API_BASE}/orders`, { credentials: "include" });
  if (!res.ok) throw new Error("Nu s-au putut încărca comenzile");
  return res.json();
}

export function useOrders() {
  return useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
}

async function resendOrder(id: string): Promise<CreateOrderResult> {
  const res = await fetch(`${API_BASE}/orders/${id}/resend`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Retrimiterea emailului a eșuat");
  return res.json();
}

export function useResendOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resendOrder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}
