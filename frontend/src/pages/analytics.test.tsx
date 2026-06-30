import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsPage } from "./analytics";
import type { ClientAnalytics } from "@/lib/analytics";

const mockUseAnalytics = vi.fn();
vi.mock("@/lib/analytics", async (orig) => ({
  ...(await orig<typeof import("@/lib/analytics")>()),
  useAnalytics: () => mockUseAnalytics(),
}));

const DATA: ClientAnalytics = {
  period: { gte: "2026-06-01T00:00:00.000Z", lte: "2026-06-03T00:00:00.000Z" },
  features: [
    {
      key: "vendor_communication",
      name: "Comunicare furnizori",
      metrics: [
        { key: "orders", label: "Comenzi", unit: "count", total: 5 },
        { key: "emailsSent", label: "Emailuri trimise", unit: "count", total: 8 },
      ],
      trend: [
        { date: "2026-06-01", values: { orders: 2, emailsSent: 3 } },
        { date: "2026-06-02", values: { orders: 0, emailsSent: 1 } },
        { date: "2026-06-03", values: { orders: 3, emailsSent: 4 } },
      ],
    },
  ],
};

describe("AnalyticsPage", () => {
  it("renders feature totals and a chart without hook errors", () => {
    mockUseAnalytics.mockReturnValue({ data: DATA, isLoading: false, isError: false });
    render(<AnalyticsPage />);
    expect(screen.getByText("Comunicare furnizori")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // orders total
    expect(screen.getAllByText("Comenzi").length).toBeGreaterThan(0);
  });

  it("shows empty state when no features are active", () => {
    mockUseAnalytics.mockReturnValue({ data: { period: DATA.period, features: [] }, isLoading: false, isError: false });
    render(<AnalyticsPage />);
    expect(screen.getByText("Nicio funcționalitate activă încă.")).toBeInTheDocument();
  });
});
