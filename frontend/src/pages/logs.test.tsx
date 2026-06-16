import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogsTab } from "./logs";
import type { LogRow } from "@/lib/logs";

const mockUseLogs = vi.fn();
const fetchNextPage = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/logs", () => ({
  useLogs: (filters: unknown) => mockUseLogs(filters),
}));

vi.mock("@/lib/organizations", () => ({
  useOrganizations: () => ({ data: [{ id: "O1", name: "Org One" }] }),
}));

const LOG: LogRow = {
  id: "L1", level: "error", source: "backend", message: "boom happened",
  stack: "at thing (file.ts:1)", context: { foo: "bar" },
  requestId: "r1", userId: null, orgId: "O1", url: null, userAgent: null,
  createdAt: "2026-06-15T08:00:00.000Z",
};

function result(over: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ logs: [LOG], nextCursor: null }] },
    isLoading: false, isError: false, isFetching: false,
    hasNextPage: false, isFetchingNextPage: false,
    fetchNextPage, refetch,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseLogs.mockReturnValue(result());
});

describe("LogsTab", () => {
  it("renders a log row with its level badge", () => {
    render(<LogsTab />);
    expect(screen.getByText("boom happened")).toBeInTheDocument();
    expect(screen.getByText("error", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Org One", { selector: "td" })).toBeInTheDocument();
  });

  it("opens the detail dialog with stack and context on row click", async () => {
    const user = userEvent.setup();
    render(<LogsTab />);
    await user.click(screen.getByText("boom happened"));
    expect(screen.getByText("Detalii log")).toBeInTheDocument();
    expect(screen.getByText("at thing (file.ts:1)")).toBeInTheDocument();
    expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
  });

  it("passes the level filter to useLogs when changed", async () => {
    const user = userEvent.setup();
    render(<LogsTab />);
    await user.selectOptions(screen.getByLabelText("Nivel"), "warn");
    expect(mockUseLogs).toHaveBeenLastCalledWith({ level: "warn" });
  });

  it("commits the search box to a q filter on submit", async () => {
    const user = userEvent.setup();
    render(<LogsTab />);
    await user.type(screen.getByPlaceholderText("Caută în mesaj…"), "timeout");
    await user.click(screen.getByRole("button", { name: "Caută" }));
    expect(mockUseLogs).toHaveBeenLastCalledWith({ q: "timeout" });
  });

  it("shows an empty state when there are no logs", () => {
    mockUseLogs.mockReturnValue(result({ data: { pages: [{ logs: [], nextCursor: null }] } }));
    render(<LogsTab />);
    expect(screen.getByText("Niciun log.")).toBeInTheDocument();
  });
});
