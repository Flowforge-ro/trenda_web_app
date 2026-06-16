import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsageSection } from "./usage-section";
import type { UsageReport } from "@/lib/usage";

const mockUseUsage = vi.fn();
vi.mock("@/lib/usage", () => ({
  useUsage: (range: unknown) => mockUseUsage(range),
}));

const REPORT: UsageReport = {
  orgs: [
    {
      orgId: "o1", orgName: "Org One", inputTokens: 1200, outputTokens: 500, costUsd: 0.06,
      emailsRead: 12, emailsWritten: 5, appointments: 7, junk: 2,
      byModel: [{ provider: "openai", model: "gpt-5.4-mini", inputTokens: 1000, outputTokens: 400, costUsd: 0.05, calls: 3 }],
    },
  ],
  totals: { inputTokens: 1200, outputTokens: 500, costUsd: 0.06, emailsRead: 12, emailsWritten: 5, appointments: 7, junk: 2, byModel: [] },
};

function result(over: Record<string, unknown> = {}) {
  return { data: REPORT, isLoading: false, isError: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUsage.mockReturnValue(result());
});

describe("UsageSection", () => {
  it("renders overall totals and a per-org row", () => {
    render(<UsageSection />);
    // $0.0600 appears twice: the overall "Cost estimat" total card and the
    // single org's row (one org, so its cost equals the total).
    expect(screen.getAllByText("$0.0600")).toHaveLength(2);
    expect(screen.getByText("Org One")).toBeInTheDocument();
    expect(screen.getByText("Cost estimat")).toBeInTheDocument();
  });

  it("expands the per-model breakdown on click", async () => {
    const user = userEvent.setup();
    render(<UsageSection />);
    expect(screen.queryByText(/openai\/gpt-5.4-mini/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Org One/ }));
    expect(screen.getByText(/openai\/gpt-5.4-mini/)).toBeInTheDocument();
  });

  it("shows an empty state when no usage is recorded", () => {
    mockUseUsage.mockReturnValue(result({ data: { orgs: [], totals: REPORT.totals } }));
    render(<UsageSection />);
    expect(screen.getByText("Nicio utilizare înregistrată.")).toBeInTheDocument();
  });
});
