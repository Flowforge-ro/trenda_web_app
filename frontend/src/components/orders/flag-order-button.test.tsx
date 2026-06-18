import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlagOrderButton } from "./flag-order-button";
import type { Order } from "@/lib/orders";

const mockFlag = vi.fn();
const mockUnflag = vi.fn();

vi.mock("@/lib/orders", () => ({
  useFlagOrder: () => ({ mutate: mockFlag, isPending: false, isError: false }),
  useUnflagOrder: () => ({ mutate: mockUnflag, isPending: false, isError: false }),
}));

function makeOrder(over: Partial<Order> = {}): Order {
  return { id: "O1", flaggedAt: null, flagReason: null, ...over } as Order;
}

function setup(order: Order) {
  const user = userEvent.setup();
  render(<FlagOrderButton order={order} />);
  return { user };
}

beforeEach(() => {
  mockFlag.mockReset();
  mockUnflag.mockReset();
});

describe("FlagOrderButton", () => {
  it("flags an order with the typed reason", async () => {
    const { user } = setup(makeOrder());
    await user.click(screen.getByTitle("Semnalează comandă greșită"));
    await user.type(screen.getByPlaceholderText(/Ce este greșit/i), "preț greșit");
    await user.click(screen.getByRole("button", { name: "Semnalează" }));
    expect(mockFlag).toHaveBeenCalledWith(
      { id: "O1", reason: "preț greșit" },
      expect.anything()
    );
  });

  it("sends reason undefined when left blank", async () => {
    const { user } = setup(makeOrder());
    await user.click(screen.getByTitle("Semnalează comandă greșită"));
    await user.click(screen.getByRole("button", { name: "Semnalează" }));
    expect(mockFlag).toHaveBeenCalledWith({ id: "O1", reason: undefined }, expect.anything());
  });

  it("offers to remove the flag and prefills the reason when already flagged", async () => {
    const { user } = setup(makeOrder({ flaggedAt: "2026-06-17T12:00:00Z", flagReason: "greșit" }));
    await user.click(screen.getByTitle("Comandă semnalată ca greșită"));
    expect(screen.getByDisplayValue("greșit")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elimină semnalarea" }));
    expect(mockUnflag).toHaveBeenCalledWith("O1", expect.anything());
  });
});
