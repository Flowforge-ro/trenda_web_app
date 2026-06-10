import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewOrderDialog } from "@/components/orders/new-order-dialog";
import { OrderReviewDialog } from "@/components/orders/order-review-dialog";
import { cn } from "@/lib/utils";
import { CheckCircle2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrders, useResendOrder, useCloseOrder, formatDeliveryCountdown, type Order } from "@/lib/orders";

const statusStyles: Record<string, string> = {
  "Livrat": "bg-success/10 text-success",
  "În tranzit": "bg-warning/10 text-warning",
  "În așteptare": "bg-muted text-muted-foreground",
  "Anulat": "bg-error/10 text-error",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  );
}

function StatusCell({ order }: { order: Order }) {
  const resend = useResendOrder();

  if (order.closedAt) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        Închisă
      </span>
    );
  }

  const reviewBadge =
    order.replyStatus === "needs_review" ? <OrderReviewDialog order={order} /> : null;

  if (order.emailStatus === "trimis") {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status={order.status} />
        {reviewBadge}
      </div>
    );
  }
  const failed = order.emailStatus === "esuat";
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={order.status} />
      {reviewBadge}
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          failed ? "bg-error/10 text-error" : "bg-warning/10 text-warning"
        )}
      >
        {failed ? "email eșuat" : "se trimite…"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={resend.isPending}
        onClick={() => resend.mutate(order.id)}
        title="Retrimite email"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CloseOrderButton({ order }: { order: Order }) {
  const close = useCloseOrder();
  if (order.closedAt) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      disabled={close.isPending}
      onClick={() => close.mutate(order.id)}
      title="Închide comanda"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
    </Button>
  );
}

const columns = ["Numar comanda", "Piesa", "Serie sasiu", "Status", "Timp livrare", ""];

export function OrdersPage() {
  const { data: orders = [], isLoading } = useOrders();

  return (
    <div className="p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Comenzi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lista comenzilor de piese
          </p>
        </div>
        <NewOrderDialog />
      </header>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              {columns.map((c, i) => (
                <TableHead key={i} className="px-4 text-muted-foreground">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">
                  Se încarcă...
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">
                    {o.orderNumber ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.piesa}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {o.serieSasiu}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusCell order={o} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground" title={o.deliveryTime ?? undefined}>
                    {o.deliveryEarliest && o.deliveryLatest
                      ? formatDeliveryCountdown(o.deliveryEarliest, o.deliveryLatest)
                      : o.deliveryTime ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <CloseOrderButton order={o} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
