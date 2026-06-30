import { type ReactNode } from "react";
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
import { OfferDialog } from "@/components/orders/offer-dialog";
import { FlagOrderButton } from "@/components/orders/flag-order-button";
import { cn } from "@/lib/utils";
import { CheckCircle2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrders, useResendOrder, useCloseOrder, formatDeliveryCountdown, type Order } from "@/lib/orders";
import { useIsMobile } from "@/lib/use-is-mobile";

// Order.status as the backend actually sets it: the default plus the two
// extraction outcomes. There is no delivery/cancellation tracking (we have no
// courier or supplier-cancel signal), so no "delivered"/"cancelled" states exist.
const statusStyles: Record<string, string> = {
  "În așteptare": "bg-muted text-muted-foreground",
  extracted: "bg-blue-100 text-blue-700",
  needs_review: "bg-warning/10 text-warning",
};
const statusLabels: Record<string, string> = {
  "În așteptare": "În așteptare",
  extracted: "Ofertă primită",
  needs_review: "De verificat",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {statusLabels[status] ?? status}
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
  const offerBadge =
    order.replyStatus === "offer_pending" ? <OfferDialog order={order} /> : null;

  if (order.emailStatus === "trimis") {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge status={order.status} />
        {reviewBadge}
        {offerBadge}
      </div>
    );
  }
  const failed = order.emailStatus === "esuat";
  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={order.status} />
      {reviewBadge}
      {offerBadge}
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

const columns = ["Numar comanda", "Piesa", "Serie sasiu", "Status", "Timp livrare", "Preț", ""];

function CardField({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right text-foreground", mono && "font-mono text-xs")}>{children}</span>
    </div>
  );
}

/** Mobile card mirroring one table row; reuses the same cells/actions. */
function OrderCard({ order }: { order: Order }) {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-medium text-foreground">{order.orderNumber ?? "—"}</p>
        <div className="flex shrink-0 items-center gap-1">
          <FlagOrderButton order={order} />
          <CloseOrderButton order={order} />
        </div>
      </div>
      <StatusCell order={order} />
      <div className="space-y-1 border-t border-gray-100 pt-3">
        <CardField label="Piesa">{order.partCode}</CardField>
        <CardField label="Serie șasiu" mono>{order.chassisSeries}</CardField>
        <CardField label="Timp livrare">
          {order.deliveryEarliest && order.deliveryLatest
            ? formatDeliveryCountdown(order.deliveryEarliest, order.deliveryLatest)
            : order.deliveryTime ?? "—"}
        </CardField>
        <CardField label="Preț">{order.offerPrice ?? "—"}</CardField>
      </div>
    </div>
  );
}

export function OrdersPage() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrders();
  const orders = data?.pages.flatMap((p) => p.orders) ?? [];
  const isMobile = useIsMobile();

  return (
    <div className="p-4 sm:p-8">
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

      {/* Cards below md, table at md+ — rendered exclusively so rows never need horizontal scroll. */}
      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Se încarcă...</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nicio comandă.</p>
          ) : (
            orders.map((o) => <OrderCard key={o.id} order={o} />)
          )}
        </div>
      ) : (
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
                  <TableCell className="px-4 py-3 text-foreground">{o.partCode}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {o.chassisSeries}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusCell order={o} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground" title={o.deliveryTime ?? undefined}>
                    {o.deliveryEarliest && o.deliveryLatest
                      ? formatDeliveryCountdown(o.deliveryEarliest, o.deliveryLatest)
                      : o.deliveryTime ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {o.offerPrice ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <FlagOrderButton order={o} />
                      <CloseOrderButton order={o} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      )}

      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Se încarcă..." : "Încarcă mai multe"}
          </Button>
        </div>
      )}
    </div>
  );
}
