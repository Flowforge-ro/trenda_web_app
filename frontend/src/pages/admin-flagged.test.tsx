import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlaggedOrdersTab } from "./admin-flagged";
import type { FlaggedOrder } from "@/lib/flagged-orders";

const mockUseFlaggedOrders = vi.fn();
vi.mock("@/lib/flagged-orders", () => ({
  useFlaggedOrders: () => mockUseFlaggedOrders(),
}));

const ORDER: FlaggedOrder = {
  id: "ord1",
  orderNumber: "CMD-9",
  partCode: "FIL-9921",
  chassisSeries: "WVW9",
  registrationNumber: "B-123-XYZ",
  vendorEmail: "f@ex.ro",
  offerPrice: "120 RON",
  deliveryTime: "5-7 zile lucrătoare",
  deliveryEarliest: "2026-06-24",
  deliveryLatest: "2026-06-26",
  status: "extracted",
  replyStatus: "offer_pending",
  orderNumberConfidence: "high",
  deliveryConfidence: "low",
  reviewReasons: "Termen livrare neclar",
  flaggedAt: "2026-06-17T12:00:00Z",
  flagReason: "preț greșit",
  org: { id: "o1", name: "Acme SRL" },
  flaggedBy: { id: "U7", email: "m@ex.ro", name: "Member" },
  replies: [
    {
      fromEmail: "f@ex.ro",
      subject: "Re: Cerere",
      body: "Vă oferim piesa la 120 lei.",
      receivedDateTime: "2026-06-16T08:00:00Z",
      hasAttachments: true,
    },
  ],
};

describe("FlaggedOrdersTab", () => {
  it("lists flagged orders and opens a detail dialog with the email and extracted fields", async () => {
    mockUseFlaggedOrders.mockReturnValue({ data: [ORDER], isLoading: false, isError: false });
    const user = userEvent.setup();
    render(<FlaggedOrdersTab />);

    expect(screen.getByText("Acme SRL")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Detalii" }));

    // Source email
    expect(screen.getByText("Vă oferim piesa la 120 lei.")).toBeInTheDocument();
    expect(screen.getByText(/Atașamente: da/)).toBeInTheDocument();
    // Extracted result
    expect(screen.getByText("24.06.2026 – 26.06.2026")).toBeInTheDocument();
    expect(screen.getByText("Termen livrare neclar")).toBeInTheDocument();
    // Flag info (appears in both the row and the dialog)
    expect(screen.getAllByText("preț greșit").length).toBeGreaterThanOrEqual(2);
  });

  it("shows an empty state when nothing is flagged", () => {
    mockUseFlaggedOrders.mockReturnValue({ data: [], isLoading: false, isError: false });
    render(<FlaggedOrdersTab />);
    expect(screen.getByText("Nicio comandă semnalată.")).toBeInTheDocument();
  });
});
