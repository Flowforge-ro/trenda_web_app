import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useOrderReview,
  useSaveReview,
  type Order,
  type OrderReview,
} from "@/lib/orders";
import { OfferReplyView } from "./offer-reply-view";

function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function LowConfidenceMark() {
  return (
    <span className="ml-1.5 rounded-sm bg-warning/10 px-1 text-[10px] font-medium text-warning">
      de verificat
    </span>
  );
}


export function OrderReviewDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useOrderReview(order.id, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md border border-warning/30 bg-warning/10 px-2.5 text-xs font-medium text-warning shadow-sm transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
          />
        }
      >
        verifică
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verifică răspunsul furnizorului</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <>
            <p className="text-sm text-muted-foreground">Se încarcă…</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Anulează</DialogClose>
            </DialogFooter>
          </>
        ) : isError || !data ? (
          <>
            <p className="text-sm text-error">Nu s-a putut încărca răspunsul.</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Anulează</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <ReviewForm order={order} data={data} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({ order, data, onClose }: { order: Order; data: OrderReview; onClose: () => void }) {
  const save = useSaveReview();
  // Seeded from the fetched review at mount. The dialog unmounts this on close,
  // so a reopen (served from React Query cache) restarts from server values.
  const [orderNumber, setorderNumber] = useState(data.current.orderNumber ?? "");
  const [earliest, setEarliest] = useState(isoToDateInput(data.current.deliveryEarliest));
  const [latest, setLatest] = useState(isoToDateInput(data.current.deliveryLatest));

  function handleSave() {
    save.mutate(
      {
        id: order.id,
        payload: {
          orderNumber: orderNumber.trim() || null,
          deliveryEarliest: earliest || null,
          deliveryLatest: latest || null,
        },
      },
      { onSuccess: onClose }
    );
  }

  return (
    <>
      <div className="space-y-4">
            {data.reasons.length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <p className="font-medium">De verificat:</p>
                <ul className="mt-1 list-disc pl-4">
                  {data.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <OfferReplyView orderId={order.id} data={data} />

            <div className="space-y-3 border-t border-gray-200 pt-3">
              <div className="space-y-1">
                <Label htmlFor="orderNumber">
                  Număr comandă
                  {data.confidence.orderNumber === "low" ? <LowConfidenceMark /> : null}
                </Label>
                <Input
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setorderNumber(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="earliest">
                    Livrare (de la)
                    {data.confidence.delivery === "low" ? <LowConfidenceMark /> : null}
                  </Label>
                  <Input
                    id="earliest"
                    type="date"
                    value={earliest}
                    onChange={(e) => setEarliest(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="latest">
                    Livrare (până la)
                    {data.confidence.delivery === "low" ? <LowConfidenceMark /> : null}
                  </Label>
                  <Input
                    id="latest"
                    type="date"
                    value={latest}
                    onChange={(e) => setLatest(e.target.value)}
                  />
                </div>
              </div>
              {save.isError ? (
                <p className="text-xs text-error">Salvarea a eșuat.</p>
              ) : null}
            </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Anulează</DialogClose>
        <Button type="button" disabled={save.isPending} onClick={handleSave}>
          Salvează
        </Button>
      </DialogFooter>
    </>
  );
}
