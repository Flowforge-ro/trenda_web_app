import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./http";
import { logAction } from "./logger";

export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
}

async function fetchVendors(search?: string): Promise<Vendor[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const qs = params.toString();
  const res = await apiFetch(`/vendors${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Nu s-au putut încărca furnizorii");
  return res.json();
}

export function useVendors(search?: string) {
  return useQuery({
    queryKey: ["vendors", search ?? ""],
    queryFn: () => fetchVendors(search),
  });
}

export interface NewVendorPayload {
  name: string;
  email: string;
  phone?: string;
}

async function createVendor(payload: NewVendorPayload): Promise<Vendor> {
  const res = await apiFetch("/vendors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Crearea furnizorului a eșuat");
  return res.json();
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createVendor,
    onSuccess: (vendor) => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      logAction("vendor.create", { vendorId: vendor.id });
    },
  });
}
