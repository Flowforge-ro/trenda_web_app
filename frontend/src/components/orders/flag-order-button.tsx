import { useState } from "react";
import { Flag } from "lucide-react";
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
import { useFlagOrder, useUnflagOrder, type Order } from "@/lib/orders";

export function FlagOrderButton({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const flag = useFlagOrder();
  const unflag = useUnflagOrder();
  const flagged = order.flaggedAt != null;
  const pending = flag.isPending || unflag.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setReason(order.flagReason ?? ""); }}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={flagged ? "Comandă semnalată ca greșită" : "Semnalează comandă greșită"}
          />
        }
      >
        <Flag className={`h-3.5 w-3.5 ${flagged ? "fill-error text-error" : ""}`} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Semnalează comandă greșită</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <label htmlFor="flag-reason" className="text-sm font-medium text-foreground">
            Motiv (opțional)
          </label>
          <textarea
            id="flag-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Ce este greșit la această comandă?"
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          {(flag.isError || unflag.isError) && (
            <p className="text-sm text-error">A apărut o eroare. Încearcă din nou.</p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Anulează</DialogClose>
          {flagged && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => unflag.mutate(order.id, { onSuccess: () => setOpen(false) })}
            >
              Elimină semnalarea
            </Button>
          )}
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              flag.mutate(
                { id: order.id, reason: reason.trim() || undefined },
                { onSuccess: () => setOpen(false) }
              )
            }
          >
            {flagged ? "Actualizează" : "Semnalează"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
