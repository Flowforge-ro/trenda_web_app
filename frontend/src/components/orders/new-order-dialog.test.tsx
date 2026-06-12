import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrderDialog } from "./new-order-dialog";

// Hoist mocks so vi.mock() can reference them
const mockMutate = vi.fn();
const mockCreateOrder = vi.fn(() => ({
  mutate: mockMutate,
  isPending: false,
  isError: false,
}));

vi.mock("@/lib/orders", () => ({
  useCreateOrder: () => mockCreateOrder(),
}));

vi.mock("@/lib/mailboxes", () => ({
  useMailboxes: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logAction: vi.fn(),
}));

import { useMailboxes } from "@/lib/mailboxes";

const MB1 = { id: "mb1", email: "furnizor@exemplu.ro", type: "vendor_facing" as const };
const MB2 = { id: "mb2", email: "alt@exemplu.ro", type: "vendor_facing" as const };
const MB_CLIENT = { id: "mb3", email: "client@exemplu.ro", type: "client_facing" as const };

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function setup(mailboxes = [MB1]) {
  vi.mocked(useMailboxes).mockReturnValue({ data: mailboxes } as ReturnType<typeof useMailboxes>);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={qc()}>
      <NewOrderDialog />
    </QueryClientProvider>
  );
  return { user };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Comandă nouă/i }));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateOrder.mockReturnValue({ mutate: mockMutate, isPending: false, isError: false });
});

describe("NewOrderDialog", () => {
  it("renders the trigger button", () => {
    setup();
    expect(screen.getByRole("button", { name: /Comandă nouă/i })).toBeInTheDocument();
  });

  it("opens dialog with all form fields when trigger is clicked", async () => {
    const { user } = setup();
    await openDialog(user);

    expect(screen.getByLabelText(/Cutie poștală/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email furnizor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Serie sasiu/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Piesa/i)).toBeInTheDocument();
  });

  it("auto-selects the only vendor mailbox when dialog opens", async () => {
    const { user } = setup([MB1]);
    await openDialog(user);

    const select = screen.getByLabelText(/Cutie poștală/i) as HTMLSelectElement;
    expect(select.value).toBe("mb1");
  });

  it("shows select with multiple options when there are multiple vendor mailboxes", async () => {
    const { user } = setup([MB1, MB2]);
    await openDialog(user);

    const select = screen.getByLabelText(/Cutie poștală/i) as HTMLSelectElement;
    // No auto-select with multiple mailboxes
    expect(screen.getByRole("option", { name: "furnizor@exemplu.ro" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "alt@exemplu.ro" })).toBeInTheDocument();
    // Submit button disabled until mailboxId selected
    expect(screen.getByRole("button", { name: /Trimite/i })).toBeDisabled();
    await user.selectOptions(select, "mb2");
    expect(select.value).toBe("mb2");
  });

  it("shows error message when no vendor mailboxes exist", async () => {
    const { user } = setup([]);
    await openDialog(user);

    expect(screen.getByText(/Nicio cutie poștală pentru furnizori/i)).toBeInTheDocument();
    // No select rendered
    expect(screen.queryByLabelText(/Cutie poștală/i)).not.toBeInTheDocument();
  });

  it("filters out non-vendor mailboxes", async () => {
    const { user } = setup([MB1, MB_CLIENT]);
    await openDialog(user);

    // Only MB1 vendor mailbox; auto-selected
    const select = screen.getByLabelText(/Cutie poștală/i) as HTMLSelectElement;
    expect(select.value).toBe("mb1");
    expect(screen.queryByRole("option", { name: "client@exemplu.ro" })).not.toBeInTheDocument();
  });

  it("calls createOrder mutate exactly once with typed payload on submit", async () => {
    const { user } = setup([MB1]);
    await openDialog(user);

    await user.type(screen.getByLabelText(/Email furnizor/i), "furnizor@test.ro");
    await user.type(screen.getByLabelText(/Serie sasiu/i), "WVWZZZ1KZAW000001");
    await user.type(screen.getByLabelText(/Piesa/i), "Filtru ulei");

    await user.click(screen.getByRole("button", { name: /Trimite/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
    expect(mockMutate).toHaveBeenCalledWith(
      {
        emailFurnizor: "furnizor@test.ro",
        serieSasiu: "WVWZZZ1KZAW000001",
        piesa: "Filtru ulei",
        mailboxId: "mb1",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("closes dialog and resets form on successful submit", async () => {
    const { user } = setup([MB1]);
    await openDialog(user);

    await user.type(screen.getByLabelText(/Email furnizor/i), "furnizor@test.ro");
    await user.type(screen.getByLabelText(/Serie sasiu/i), "WVWZZZ1KZAW000001");
    await user.type(screen.getByLabelText(/Piesa/i), "Filtru ulei");

    // Simulate success by calling the onSuccess callback directly
    mockMutate.mockImplementationOnce((_payload: unknown, opts: { onSuccess: (r: { emailSent: boolean }) => void }) => {
      opts.onSuccess({ emailSent: true });
    });

    await user.click(screen.getByRole("button", { name: /Trimite/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows error text and keeps dialog open on failure", async () => {
    mockCreateOrder.mockReturnValue({ mutate: mockMutate, isPending: false, isError: true });
    const { user } = setup([MB1]);
    await openDialog(user);

    expect(screen.getByText(/Crearea comenzii a eșuat/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables submit button while pending", async () => {
    mockCreateOrder.mockReturnValue({ mutate: mockMutate, isPending: true, isError: false });
    const { user } = setup([MB1]);
    await openDialog(user);

    expect(screen.getByRole("button", { name: /Se trimite/i })).toBeDisabled();
  });
});
