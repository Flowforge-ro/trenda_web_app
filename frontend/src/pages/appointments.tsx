import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppointments, type Appointment } from "@/lib/appointments";
import { ConversationDialog } from "@/components/appointments/conversation-dialog";
import { useIsMobile } from "@/lib/use-is-mobile";

function StatusBadge({ status }: { status: Appointment["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "complete" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      )}
    >
      {status === "complete" ? "Completă" : "Colectare date"}
    </span>
  );
}

function FilledFields({ fields }: { fields: Appointment["filledFields"] }) {
  if (fields.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {fields.map((f) => (
        <div key={f.label} className="text-xs">
          <span className="text-muted-foreground">{f.label}:</span> <span className="text-foreground">{f.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Mobile card mirroring one table row; reuses the same cells/actions. */
function AppointmentCard({ appointment: a }: { appointment: Appointment }) {
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-all font-medium text-foreground">{a.customerEmail}</p>
        <div className="shrink-0">
          <ConversationDialog appointment={a} />
        </div>
      </div>
      <StatusBadge status={a.status} />
      <div className="space-y-2 border-t border-gray-100 pt-3 text-sm">
        <div>
          <p className="text-muted-foreground">Date completate</p>
          <div className="mt-0.5"><FilledFields fields={a.filledFields} /></div>
        </div>
        <div>
          <p className="text-muted-foreground">Lipsesc</p>
          <p className="mt-0.5 text-foreground">{a.missingLabels.length > 0 ? a.missingLabels.join(", ") : "—"}</p>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Ultimul mesaj</span>
          <span className="text-right text-foreground">{new Date(a.lastMessageAt).toLocaleString("ro-RO")}</span>
        </div>
      </div>
    </div>
  );
}

export function AppointmentsPage() {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useAppointments();
  const appointments = data?.pages.flatMap((p) => p.appointments) ?? [];
  const isMobile = useIsMobile();

  return (
    <div className="p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Programări</h1>
        <p className="mt-1 text-sm text-muted-foreground">Emailuri de la clienți clasificate ca programări</p>
      </header>

      {/* Cards below md, table at md+ — rendered exclusively so rows never need horizontal scroll. */}
      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Se încarcă...</p>
          ) : isError ? (
            <p className="text-sm text-error">Nu s-au putut încărca programările.</p>
          ) : appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nicio programare.</p>
          ) : (
            appointments.map((a) => <AppointmentCard key={a.id} appointment={a} />)
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="px-4 text-muted-foreground">Client</TableHead>
              <TableHead className="px-4 text-muted-foreground">Stare</TableHead>
              <TableHead className="px-4 text-muted-foreground">Date completate</TableHead>
              <TableHead className="px-4 text-muted-foreground">Lipsesc</TableHead>
              <TableHead className="px-4 text-muted-foreground">Ultimul mesaj</TableHead>
              <TableHead className="px-4 text-muted-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Se încarcă...</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-6 text-center text-error">Nu s-au putut încărca programările.</TableCell></TableRow>
            ) : appointments.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nicio programare.</TableCell></TableRow>
            ) : (
              appointments.map((a) => (
                <TableRow key={a.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">{a.customerEmail}</TableCell>
                  <TableCell className="px-4 py-3"><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="px-4 py-3"><FilledFields fields={a.filledFields} /></TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">
                    {a.missingLabels.length > 0 ? a.missingLabels.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {new Date(a.lastMessageAt).toLocaleString("ro-RO")}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <ConversationDialog appointment={a} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      )}

      {hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Se încarcă…" : "Încarcă mai multe"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
