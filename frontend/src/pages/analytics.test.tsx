import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsPage } from "./analytics";

vi.mock("../lib/analytics", () => ({
  useOverview: () => ({ data: { openOrders: 12, overdue: 3, dueSoon: 4 }, isLoading: false }),
  useTimeSaved: () => ({ data: { emailsSent: 10, emailsRead: 7, repliesParsed: 2, minutesSaved: 38, hoursSaved: 0.63, valueSavedRon: 22 }, isLoading: false }),
  useVendorScorecard: () => ({
    data: [
      { vendorEmail: "v@x", name: "Acme SRL", orders: 9, answered: 8, orderShare: 0.75, avgResponseHours: 2.5, needsReviewRate: 0.1, bounceRate: 0, onTimeRate: 0.9 },
    ],
    isLoading: false,
  }),
}));

describe("AnalyticsPage", () => {
  it("shows operational KPI cards", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText(/Comenzi deschise/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/Întârziate/i)).toBeInTheDocument();
  });

  it("shows activity without AI cost or ROI", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText(/Emailuri trimise/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cost AI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ROI/i)).not.toBeInTheDocument();
  });

  it("lists vendor performance with name and dependency share", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("Acme SRL")).toBeInTheDocument();
    expect(screen.getAllByText(/75%/).length).toBeGreaterThan(0); // order share / dependency
  });
});
