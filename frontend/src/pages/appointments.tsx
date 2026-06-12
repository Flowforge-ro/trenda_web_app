import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppointments, type Appointment } from "@/lib/appointments";

function AppointmentStatusBadge({ status }: { status: Appointment["status"] }) {
  const complete = status === "complete";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        complete ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      )}
    >
      {complete ? "Completă" : "Colectare date"}
    </span>
  );
}

function filledFields(fields: Record<string, string | null>): string {
  const filled = Object.entries(fields).filter(([, v]) => v !== null && v !== "");
  if (filled.length === 0) return "—";
  return filled.map(([k, v]) => `${k}: ${v}`).join(", ");
}

const columns = ["Client", "Status", "Date completate", "Lipsesc", "Ultimul mesaj"];

export function AppointmentsPage() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useAppointments();
  const appointments = data?.pages.flatMap((p) => p.appointments) ?? [];

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Programări
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cereri de programare primite de la clienți
        </p>
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
            ) : appointments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">
                  Nicio programare încă
                </TableCell>
              </TableRow>
            ) : (
              appointments.map((a) => (
                <TableRow key={a.id} className="hover:bg-gray-100">
                  <TableCell className="px-4 py-3 font-medium text-foreground">
                    {a.customerEmail}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <AppointmentStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {filledFields(a.fields)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">
                    {a.missingLabels.length > 0 ? a.missingLabels.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {new Date(a.lastMessageAt).toLocaleString("ro-RO")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
