import { useState } from "react";
import { MessageSquare, Flag } from "lucide-react";
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
import {
  useAppointmentConversation,
  type Appointment,
  type ConversationMessage,
} from "@/lib/appointments";

function MessageCard({
  message,
  customerEmail,
}: {
  message: ConversationMessage;
  customerEmail: string;
}) {
  const fromCustomer =
    message.fromEmail?.toLowerCase() === customerEmail.toLowerCase();
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
            fromCustomer ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          {fromCustomer ? "Client" : "Noi"}
        </span>
        <span className="truncate text-muted-foreground">
          {message.fromEmail ?? "—"} · {new Date(message.receivedDateTime).toLocaleString("ro-RO")}
        </span>
      </div>
      {message.subject ? (
        <p className="text-sm font-medium text-foreground">{message.subject}</p>
      ) : null}
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.body ?? "—"}</p>
    </div>
  );
}

export function ConversationDialog({ appointment }: { appointment: Appointment }) {
  const [open, setOpen] = useState(false);
  // UI-only flag for the demo — not persisted to the backend.
  const [flagged, setFlagged] = useState(false);
  const [reason, setReason] = useState("");
  const { data, isLoading, isError } = useAppointmentConversation(appointment.id, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Vezi conversația"
          />
        }
      >
        <MessageSquare className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="truncate">
              Conversație — {appointment.customerEmail}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title={flagged ? "Conversație semnalată" : "Semnalează conversația"}
              onClick={() => setFlagged((f) => !f)}
            >
              <Flag className={`h-4 w-4 ${flagged ? "fill-error text-error" : ""}`} />
            </Button>
          </div>
        </DialogHeader>

        {flagged ? (
          <div className="grid gap-1.5">
            <label htmlFor="conv-flag-reason" className="text-sm font-medium text-foreground">
              Motiv (opțional)
            </label>
            <textarea
              id="conv-flag-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="De ce este semnalată această conversație?"
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Se încarcă…</p>
        ) : isError ? (
          <p className="text-sm text-error">Nu s-a putut încărca conversația.</p>
        ) : !data || data.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Niciun mesaj încă.</p>
        ) : (
          <div className="space-y-3">
            {data.messages.map((m) => (
              <MessageCard key={m.id} message={m} customerEmail={data.customerEmail} />
            ))}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Închide</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
