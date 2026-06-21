import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsPage } from "./analytics";

vi.mock("../lib/analytics", () => ({
  useTimeSaved: () => ({ data: { emailsSent: 10, repliesParsed: 2, minutesSaved: 38, hoursSaved: 0.63, valueSavedRon: 22, costUsd: 1, roi: 4.82 }, isLoading: false }),
  useDeliveryBoard: () => ({ data: { upcoming: [{ id: "U", vendorEmail: "v@x", partCode: "PC", chassisSeries: "CS", orderNumber: "N1", deliveryEarliest: "2026-06-24T00:00:00Z", deliveryLatest: null, status: "x" }], overdue: [] }, isLoading: false }),
  useVendorScorecard: () => ({ data: [{ vendorEmail: "a@x", orders: 5, answered: 4, avgResponseHours: 2.5, needsReviewRate: 0.25, bounceRate: 0, onTimeRate: 1 }], isLoading: false }),
}));

describe("AnalyticsPage", () => {
  it("shows hours saved and ROI", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText(/Timp economisit/i)).toBeInTheDocument();
    expect(screen.getByText(/4\.8/)).toBeInTheDocument(); // roi rounded
  });

  it("lists upcoming deliveries", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("PC")).toBeInTheDocument();
  });

  it("shows vendor scorecard", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("a@x")).toBeInTheDocument();
  });
});
