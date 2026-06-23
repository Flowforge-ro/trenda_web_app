import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfferDialog } from "./offer-dialog";
import type { Order, OrderReview } from "@/lib/orders";

const mockAcceptMutate = vi.fn();
const mockRejectMutate = vi.fn();

vi.mock("@/lib/orders", () => ({
  useOrderReview: vi.fn(),
  useAcceptOffer: vi.fn(() => ({ mutate: mockAcceptMutate, isPending: false })),
  useRejectOffer: vi.fn(() => ({ mutate: mockRejectMutate, isPending: false })),
  attachmentUrl: (orderId: string, attId: string) => `/orders/${orderId}/attachments?attachmentId=${attId}`,
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

import { useOrderReview } from "@/lib/orders";

const OFFER_ORDER = { id: "O2", replyStatus: "offer_pending", offerPrice: "1500 RON" } as Order;

const REVIEW: OrderReview = {
  reply: {
    fromEmail: "vendor@ex.ro",
    subject: "Oferta",
    receivedDateTime: "2026-06-10T09:00:00Z",
    body: "Va oferim piesa la pretul de 1500 RON",
  },
  attachments: [],
  current: {
    orderNumber: null,
    deliveryTime: null,
    deliveryEarliest: null,
    deliveryLatest: null,
  },
  confidence: { orderNumber: "high", delivery: "high" },
  reasons: [],
};

type ReviewResult = { data?: OrderReview; isLoading: boolean; isError: boolean };

function setup(review: ReviewResult) {
  vi.mocked(useOrderReview).mockImplementation(
    (_id: string, enabled: boolean) =>
      (enabled ? review : { isLoading: false, isError: false }) as ReturnType<typeof useOrderReview>
  );
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OfferDialog order={OFFER_ORDER} />
    </QueryClientProvider>
  );
  return { user };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Vezi oferta/i }));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OfferDialog", () => {
  it("opens, shows the reply, and fires accept", async () => {
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);

    expect(screen.getByText(/Va oferim piesa la pretul de 1500 RON/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Acceptă/i }));

    expect(mockAcceptMutate).toHaveBeenCalledOnce();
    expect(mockAcceptMutate).toHaveBeenCalledWith(
      OFFER_ORDER.id,
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("shows review reasons (e.g. part code mismatch)", async () => {
    const { user } = setup({
      data: { ...REVIEW, reasons: ["Număr piesă diferit"] },
      isLoading: false,
      isError: false,
    });
    await openDialog(user);

    expect(screen.getByText("De verificat:")).toBeInTheDocument();
    expect(screen.getByText("Număr piesă diferit")).toBeInTheDocument();
  });

  it("fires reject", async () => {
    const { user } = setup({ data: REVIEW, isLoading: false, isError: false });
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: /Respinge/i }));

    expect(mockRejectMutate).toHaveBeenCalledOnce();
    expect(mockRejectMutate).toHaveBeenCalledWith(
      OFFER_ORDER.id,
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });
});
