import { useEffect, useState } from "react";
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
  attachmentUrl,
  type Order,
  type ReviewAttachment,
} from "@/lib/orders";

function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function AttachmentView({ orderId, att }: { orderId: string; att: ReviewAttachment }) {
  const url = attachmentUrl(orderId, att.id);
  const type = att.contentType ?? "";
  return (
    <div className="rounded-md border border-gray-200 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{att.name}</span>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Descarcă
        </a>
      </div>
      {type === "application/pdf" ? (
        <object data={url} type="application/pdf" className="h-96 w-full">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs underline">
            Deschide PDF
          </a>
        </object>
      ) : type.startsWith("image/") ? (
        <img src={url} alt={att.name} className="max-h-96 w-auto" />
      ) : null}
    </div>
  );
}

export function OrderReviewDialog({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useOrderReview(order.id, open);
  const save = useSaveReview();

  const [orderNumber, setorderNumber] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latest, setLatest] = useState("");

  useEffect(() => {
    if (data) {
      setorderNumber(data.current.orderNumber ?? "");
      setEarliest(isoToDateInput(data.current.deliveryEarliest));
      setLatest(isoToDateInput(data.current.deliveryLatest));
    }
  }, [data]);

  // Discard unsaved edits when the dialog closes, so a reopen (served from
  // React Query cache) shows server values, not the previous session's input.
  useEffect(() => {
    if (!open) {
      setorderNumber("");
      setEarliest("");
      setLatest("");
    }
  }, [open]);

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
      { onSuccess: () => setOpen(false) }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20"
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
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : isError || !data ? (
          <p className="text-sm text-error">Nu s-a putut încărca răspunsul.</p>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              <div>De la: {data.reply.fromEmail}</div>
              <div>Data: {new Date(data.reply.receivedDateTime).toLocaleString("ro-RO")}</div>
              {data.reply.subject ? <div>Subiect: {data.reply.subject}</div> : null}
            </div>

            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-foreground">
              {data.reply.body ?? "(fără text)"}
            </pre>

            {data.attachments.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Atașamente</p>
                {data.attachments.map((att) => (
                  <AttachmentView key={att.id} orderId={order.id} att={att} />
                ))}
              </div>
            ) : null}

            <div className="space-y-3 border-t border-gray-200 pt-3">
              <div className="space-y-1">
                <Label htmlFor="orderNumber">Număr comandă</Label>
                <Input
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setorderNumber(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="earliest">Livrare (de la)</Label>
                  <Input
                    id="earliest"
                    type="date"
                    value={earliest}
                    onChange={(e) => setEarliest(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor="latest">Livrare (până la)</Label>
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
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Anulează</DialogClose>
          <Button
            type="button"
            disabled={save.isPending || isLoading || isError || !data}
            onClick={handleSave}
          >
            Salvează
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
