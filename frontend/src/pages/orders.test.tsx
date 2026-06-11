import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrdersPage } from "./orders";
import type { Order } from "@/lib/orders";

const mockResendMutate = vi.fn();
const mockCloseMutate = vi.fn();
const mockFetchNextPage = vi.fn();

vi.mock("@/lib/orders", () => ({
  useOrders: vi.fn(),
  useResendOrder: () => ({ mutate: mockResendMutate, isPending: false }),
  useCloseOrder: () => ({ mutate: mockCloseMutate, isPending: false }),
  formatDeliveryCountdown: (earliest: string, latest: string) => `countdown(${earliest},${latest})`,
}));

// The dialogs have their own test suites; stub them out here.
vi.mock("@/components/orders/new-order-dialog", () => ({
  NewOrderDialog: () => <button type="button">Comandă nouă</button>,
}));
vi.mock("@/components/orders/order-review-dialog", () => ({
  OrderReviewDialog: ({ order }: { order: Order }) => <span>review:{order.id}</span>,
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

import { useOrders } from "@/lib/orders";

function baseOrder(over: Partial<Order> = {}): Order {
  return {
    id: "O1",
    emailFurnizor: "supplier@ex.ro",
    serieSasiu: "WVWZZZ1KZAW000001",
    piesa: "Filtru ulei",
    status: "În așteptare",
    orderNumber: null,
    deliveryTime: null,
    deliveryEarliest: null,
    deliveryLatest: null,
    replyStatus: "awaiting_reply",
    emailStatus: "trimis",
    closedAt: null,
    createdAt: "2026-06-01T08:00:00Z",
    ...over,
  };
}

type OrdersResult = {
  data?: { pages: { orders: Order[]; nextCursor: string | null }[] };
  isLoading: boolean;
  hasNextPage: boolean;
  fetchNextPage: typeof mockFetchNextPage;
  isFetchingNextPage: boolean;
};

function setup(orders: Order[], over: Partial<OrdersResult> = {}) {
  vi.mocked(useOrders).mockReturnValue({
    data: { pages: [{ orders, nextCursor: null }] },
    isLoading: false,
    hasNextPage: false,
    fetchNextPage: mockFetchNextPage,
    isFetchingNextPage: false,
    ...over,
  } as unknown as ReturnType<typeof useOrders>);
  render(<OrdersPage />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrdersPage", () => {
  it("shows the loading row while orders load", () => {
    setup([], { data: undefined, isLoading: true });
    expect(screen.getByText(/Se încarcă\.\.\./)).toBeInTheDocument();
  });

  it("renders an order row with em-dash fallbacks for missing fields", () => {
    setup([baseOrder()]);
    expect(screen.getByText("Filtru ulei")).toBeInTheDocument();
    expect(screen.getByText("WVWZZZ1KZAW000001")).toBeInTheDocument();
    expect(screen.getByText("În așteptare")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2); // orderNumber + delivery
  });

  it("shows the delivery countdown when both dates are present", () => {
    setup([
      baseOrder({
        deliveryEarliest: "2026-06-20T00:00:00Z",
        deliveryLatest: "2026-06-21T00:00:00Z",
      }),
    ]);
    expect(
      screen.getByText("countdown(2026-06-20T00:00:00Z,2026-06-21T00:00:00Z)")
    ).toBeInTheDocument();
  });

  it("falls back to the raw deliveryTime when only the text is known", () => {
    setup([baseOrder({ deliveryTime: "20 iunie" })]);
    expect(screen.getByText("20 iunie")).toBeInTheDocument();
  });

  it("marks a closed order and hides its close button", () => {
    setup([baseOrder({ closedAt: "2026-06-02T00:00:00Z" })]);
    expect(screen.getByText("Închisă")).toBeInTheDocument();
    expect(screen.queryByTitle("Închide comanda")).not.toBeInTheDocument();
  });

  it("closes an order via the close button", async () => {
    const { user } = setup([baseOrder()]);
    await user.click(screen.getByTitle("Închide comanda"));
    expect(mockCloseMutate).toHaveBeenCalledExactlyOnceWith("O1");
  });

  it("shows the failed-email badge and resends on retry click", async () => {
    const { user } = setup([baseOrder({ emailStatus: "esuat" })]);
    expect(screen.getByText("email eșuat")).toBeInTheDocument();
    await user.click(screen.getByTitle("Retrimite email"));
    expect(mockResendMutate).toHaveBeenCalledExactlyOnceWith("O1");
  });

  it("shows the sending badge while the email is pending", () => {
    setup([baseOrder({ emailStatus: "in_curs" })]);
    expect(screen.getByText("se trimite…")).toBeInTheDocument();
  });

  it("renders the review dialog only for orders needing review", () => {
    setup([
      baseOrder({ id: "O1", replyStatus: "needs_review" }),
      baseOrder({ id: "O2", piesa: "Altă piesă" }),
    ]);
    expect(screen.getByText("review:O1")).toBeInTheDocument();
    expect(screen.queryByText("review:O2")).not.toBeInTheDocument();
  });

  it("loads the next page via the load-more button", async () => {
    const { user } = setup([baseOrder()], { hasNextPage: true });
    await user.click(screen.getByRole("button", { name: /Încarcă mai multe/i }));
    expect(mockFetchNextPage).toHaveBeenCalledOnce();
  });

  it("flattens orders across pages", () => {
    setup([], {
      data: {
        pages: [
          { orders: [baseOrder({ id: "O1" })], nextCursor: "c1" },
          { orders: [baseOrder({ id: "O2", piesa: "Altă piesă" })], nextCursor: null },
        ],
      },
    });
    expect(screen.getByText("Filtru ulei")).toBeInTheDocument();
    expect(screen.getByText("Altă piesă")).toBeInTheDocument();
  });
});
