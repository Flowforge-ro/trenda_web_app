import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OfferReplyView } from "./offer-reply-view";
import { useOrderReview, useAcceptOffer, useRejectOffer, type Order } from "@/lib/orders";

export function OfferDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useOrderReview(order.id, open);
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const pending = accept.isPending || reject.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-primary/20"
          />
        }
      >
        Vezi oferta
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ofertă furnizor</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : isError || !data ? (
          <p className="text-sm text-error">Nu s-a putut încărca oferta.</p>
        ) : (
          <>
            {data.reasons.length > 0 ? (
              <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <p className="font-medium">De verificat:</p>
                <ul className="mt-1 list-disc pl-4">
                  {data.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <OfferReplyView orderId={order.id} data={data} />
            {order.offerPrice ? (
              <p className="text-sm font-medium text-foreground">Preț: {order.offerPrice}</p>
            ) : null}
          </>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Închide</DialogClose>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => reject.mutate(order.id, { onSuccess: () => setOpen(false) })}
          >
            Respinge
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => accept.mutate(order.id, { onSuccess: () => setOpen(false) })}
          >
            Acceptă
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
