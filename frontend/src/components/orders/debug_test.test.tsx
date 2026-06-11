import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getNodeText } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrderDialog } from "@/components/orders/new-order-dialog";

vi.mock("@/lib/orders", () => ({
  useCreateOrder: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("@/lib/mailboxes", () => ({
  useMailboxes: () => ({ data: [{ id: "mb1", email: "furnizor@exemplu.ro", type: "vendor_facing" }] }),
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("debug", () => {
  it("finds buttons by name after open", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={qc()}><NewOrderDialog /></QueryClientProvider>);
    const trigger = document.querySelector('[aria-haspopup="dialog"]') as HTMLElement;
    await user.click(trigger);
    await screen.findByRole("dialog");
    // Try to find by accessible name
    const byName = screen.queryAllByRole("button", { name: /Comandă nouă/i });
    expect(byName.length).toBe(0); // shows how many match
    // Log each button's outerHTML briefly
    const allButtons = screen.getAllByRole("button");
    expect(allButtons.length).toBe(5);
    // Check what accessible name each has
    allButtons.forEach((_b, i) => {
      try {
        const named = screen.getByRole("button", { name: allButtons[i].textContent?.trim() ?? "" });
        void named;
      } catch { /* ignore */ }
    });
  });
});
