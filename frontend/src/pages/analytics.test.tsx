import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsPage } from "./analytics";

vi.mock("../lib/analytics", () => ({
  useTimeSaved: () => ({
    data: { emailsSent: 10, repliesParsed: 2, minutesSaved: 38, hoursSaved: 0.6333, valueSavedRon: 22.17, costUsd: 1, roi: 4.82 },
    isLoading: false,
  }),
}));

describe("AnalyticsPage", () => {
  it("shows hours saved and ROI", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText(/Timp economisit/i)).toBeInTheDocument();
    expect(screen.getByText(/4\.8/)).toBeInTheDocument(); // roi rounded
  });
});
