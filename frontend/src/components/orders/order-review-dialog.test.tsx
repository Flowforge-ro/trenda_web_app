import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrderReviewDialog } from "./order-review-dialog";
import type { Order, OrderReview } from "@/lib/orders";

const mockSaveMutate = vi.fn();
const mockUseSaveReview = vi.fn(() => ({
  mutate: mockSaveMutate,
  isPending: false,
  isError: false,
}));

vi.mock("@/lib/orders", () => ({
  useOrderReview: vi.fn(),
  useSaveReview: () => mockUseSaveReview(),
  attachmentUrl: (orderId: string, attId: string) => `/orders/${orderId}/attachments/${attId}`,
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

import { useOrderReview } from "@/lib/orders";

const ORDER = { id: "O1", replyStatus: "needs_review" } as Order;

const REVIEW: OrderReview = {
  reply: {
    fromEmail: "supplier@ex.ro",
    subject: "Re: Cerere",
    receivedDateTime: "2026-06-01T10:00:00Z",
    body: "Comanda CMD42, livrare 20 iunie",
  },
  attachments: [],
  current: {
    orderNumber: "CMD42",
    deliveryTime: "20 iunie",
    deliveryEarliest: "2026-06-20T00:00:00.000Z",
    deliveryLatest: "2026-06-21T00:00:00.000Z",
  },
};

type ReviewResult = { data?: OrderReview; isLoading: boolean; isError: boolean };

function setup(review: ReviewResult) {
  // Like the real hook, only expose data once the dialog is open (enabled=true).
  vi.mocked(useOrderReview).mockImplementation(
    (_id: string, enabled: boolean) =>
      (enabled ? review : { isLoading: false, isError: false }) as ReturnType<typeof useOrderReview>
  );
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderReviewDialog order={ORDER} />
    </QueryClientProvider>
  );
  return { user };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /verifică/i }));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSaveReview.mockReturnValue({ mutate: mockSaveMutate, isPending: false, isError: false });
});

describe("OrderReviewDialog", () => {
  it("shows the loading state while the review is being fetched", async () => {
    const { user } = setup({ isLoading: true, isError: false });
    await openDialog(user);
    expect(screen.getByText(/Se încarcă/i)).toBeInTheDocument();
  });

  it("shows an error and disables save when the review fails to load", async () => {
    const { user } = setup({ isLoading: false, isError: true });
    await openDialog(user);
    expect(screen.getByText(/Nu s-a putut încărca răspunsul/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvează/i })).toBeDisabled();
  });

  it("renders the reply and pre-fills the form from current values", async () => {
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);

    expect(screen.getByText(/supplier@ex\.ro/)).toBeInTheDocument();
    expect(screen.getByText(/Comanda CMD42, livrare 20 iunie/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Număr comandă/i)).toHaveValue("CMD42");
    expect(screen.getByLabelText(/Livrare \(de la\)/i)).toHaveValue("2026-06-20");
    expect(screen.getByLabelText(/Livrare \(până la\)/i)).toHaveValue("2026-06-21");
  });

  it("saves edited values, sending null for a cleared order number", async () => {
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);

    await user.clear(screen.getByLabelText(/Număr comandă/i));
    await user.click(screen.getByRole("button", { name: /Salvează/i }));

    expect(mockSaveMutate).toHaveBeenCalledOnce();
    expect(mockSaveMutate).toHaveBeenCalledWith(
      {
        id: "O1",
        payload: { orderNumber: null, deliveryEarliest: "2026-06-20", deliveryLatest: "2026-06-21" },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("renders attachments with a download link", async () => {
    const review: OrderReview = {
      ...REVIEW,
      attachments: [{ id: "A1", name: "confirmare.pdf", contentType: "application/pdf", size: 1024 }],
    };
    const { user } = setup({ data: review, isLoading: false, isError: false });
    await openDialog(user);

    expect(screen.getByText("confirmare.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Descarcă/i })).toHaveAttribute(
      "href",
      "/orders/O1/attachments/A1"
    );
  });

  it("shows the save error message when saving fails", async () => {
    mockUseSaveReview.mockReturnValue({ mutate: mockSaveMutate, isPending: false, isError: true });
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);
    expect(screen.getByText(/Salvarea a eșuat/i)).toBeInTheDocument();
  });

  it("disables the save button while saving is pending", async () => {
    mockUseSaveReview.mockReturnValue({ mutate: mockSaveMutate, isPending: true, isError: false });
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);
    expect(screen.getByRole("button", { name: /Salvează/i })).toBeDisabled();
  });
});
