import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface TimeSaved {
  emailsSent: number;
  repliesParsed: number;
  minutesSaved: number;
  hoursSaved: number;
  valueSavedRon: number;
  costUsd: number;
  roi: number | null;
}

async function fetchTimeSaved(): Promise<TimeSaved> {
  const res = await apiFetch("/analytics/time-saved");
  if (!res.ok) throw new Error("Nu s-au putut încărca analizele");
  return res.json();
}

export function useTimeSaved() {
  return useQuery({ queryKey: ["analytics", "time-saved"], queryFn: fetchTimeSaved });
}

export interface DeliveryItem {
  id: string; vendorEmail: string; partCode: string; chassisSeries: string;
  orderNumber: string | null; deliveryEarliest: string | null; deliveryLatest: string | null; status: string;
}
export interface DeliveryBoard { upcoming: DeliveryItem[]; overdue: DeliveryItem[]; }

async function fetchDeliveries(): Promise<DeliveryBoard> {
  const res = await apiFetch("/analytics/deliveries");
  if (!res.ok) throw new Error("Nu s-au putut încărca livrările");
  return res.json();
}
export function useDeliveryBoard() {
  return useQuery({ queryKey: ["analytics", "deliveries"], queryFn: fetchDeliveries });
}

export interface VendorRow {
  vendorEmail: string; orders: number; answered: number;
  avgResponseHours: number | null; needsReviewRate: number; bounceRate: number; onTimeRate: number | null;
}
async function fetchVendors(): Promise<VendorRow[]> {
  const res = await apiFetch("/analytics/vendors");
  if (!res.ok) throw new Error("Nu s-au putut încărca furnizorii");
  return res.json();
}
export function useVendorScorecard() {
  return useQuery({ queryKey: ["analytics", "vendors"], queryFn: fetchVendors });
}
