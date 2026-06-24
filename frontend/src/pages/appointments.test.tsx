import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppointmentsPage } from "./appointments";
import type { Appointment } from "@/lib/appointments";

const mockUseAppointments = vi.fn();
vi.mock("@/lib/appointments", () => ({
  useAppointments: () => mockUseAppointments(),
}));

// The conversation dialog has its own test suite; stub it so the page test
// doesn't need its data hooks.
vi.mock("@/components/appointments/conversation-dialog", () => ({
  ConversationDialog: () => <button type="button">Conversație</button>,
}));

const APPT: Appointment = {
  id: "a1", customerEmail: "client@x.ro", status: "collecting",
  fields: { nume: "Ion", telefon: null },
  filledFields: [{ label: "Nume", value: "Ion" }], missingLabels: ["Telefon"],
  lastMessageAt: "2026-06-15T08:00:00.000Z", createdAt: "2026-06-15T07:00:00.000Z",
};

function result(over: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ appointments: [APPT], nextCursor: null }] },
    isLoading: false, isError: false, hasNextPage: false, isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAppointments.mockReturnValue(result());
});

describe("AppointmentsPage", () => {
  it("renders an appointment row with status, filled fields and missing labels", () => {
    render(<AppointmentsPage />);
    expect(screen.getByText("client@x.ro")).toBeInTheDocument();
    expect(screen.getByText("Colectare date")).toBeInTheDocument();
    expect(screen.getByText("Ion")).toBeInTheDocument();
    expect(screen.getByText("Telefon", { selector: "td" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no appointments", () => {
    mockUseAppointments.mockReturnValue(result({ data: { pages: [{ appointments: [], nextCursor: null }] } }));
    render(<AppointmentsPage />);
    expect(screen.getByText("Nicio programare.")).toBeInTheDocument();
  });
});
