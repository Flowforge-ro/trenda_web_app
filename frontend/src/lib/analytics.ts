import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./http";

export interface TimeSaved {
  emailsSent: number;
  emailsRead: number;
  repliesParsed: number;
  minutesSaved: number;
  hoursSaved: number;
  valueSavedRon: number;
  // costUsd / roi are returned by the API but intentionally not surfaced to customers.
}

async function fetchTimeSaved(): Promise<TimeSaved> {
  const res = await apiFetch("/analytics/time-saved");
  if (!res.ok) throw new Error("Nu s-au putut încărca analizele");
  return res.json();
}

export function useTimeSaved() {
  return useQuery({ queryKey: ["analytics", "time-saved"], queryFn: fetchTimeSaved });
}

export interface Overview {
  openOrders: number;
  overdue: number;
  dueSoon: number;
}

async function fetchOverview(): Promise<Overview> {
  const res = await apiFetch("/analytics/overview");
  if (!res.ok) throw new Error("Nu s-au putut încărca indicatorii");
  return res.json();
}

export function useOverview() {
  return useQuery({ queryKey: ["analytics", "overview"], queryFn: fetchOverview });
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
  vendorEmail: string; name: string | null; orders: number; answered: number; orderShare: number;
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

export interface PartPrice {
  partCode: string; currency: string; count: number; avg: number; min: number; max: number;
  vendors: { vendorEmail: string; avg: number }[];
}
async function fetchPrices(): Promise<PartPrice[]> {
  const res = await apiFetch("/analytics/prices");
  if (!res.ok) throw new Error("Nu s-au putut încărca prețurile");
  return res.json();
}
export function usePriceIntelligence() {
  return useQuery({ queryKey: ["analytics", "prices"], queryFn: fetchPrices });
}
