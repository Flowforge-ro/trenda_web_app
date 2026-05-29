import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewOrderDialog } from "@/components/orders/new-order-dialog";
import { cn } from "@/lib/utils";

type OrderStatus = "Livrat" | "În tranzit" | "În așteptare" | "Anulat";

interface Order {
  numarComanda: string;
  piesa: string;
  serieSasiu: string;
  status: OrderStatus;
  timpLivrare: string;
}

// Placeholder data — replace with API data later.
const orders: Order[] = [
  { numarComanda: "CMD-1001", piesa: "Filtru ulei", serieSasiu: "WVWZZZ1KZAW000001", status: "Livrat", timpLivrare: "2 zile" },
  { numarComanda: "CMD-1002", piesa: "Plăcuțe frână", serieSasiu: "WAUZZZ8K9BA000002", status: "În tranzit", timpLivrare: "4 zile" },
  { numarComanda: "CMD-1003", piesa: "Alternator", serieSasiu: "VF1RFB00000000003", status: "În așteptare", timpLivrare: "—" },
  { numarComanda: "CMD-1004", piesa: "Radiator apă", serieSasiu: "ZFA31200000000004", status: "Anulat", timpLivrare: "—" },
  { numarComanda: "CMD-1005", piesa: "Pompă combustibil", serieSasiu: "WBA3A5C50DF000005", status: "Livrat", timpLivrare: "1 zi" },
];

const statusStyles: Record<OrderStatus, string> = {
  "Livrat": "bg-success/10 text-success",
  "În tranzit": "bg-warning/10 text-warning",
  "În așteptare": "bg-muted text-muted-foreground",
  "Anulat": "bg-error/10 text-error",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status]
      )}
    >
      {status}
    </span>
  );
}

const columns = ["Numar comanda", "Piesa", "Serie sasiu", "Status", "Timp livrare"];

export function OrdersPage() {
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
              {columns.map((c) => (
                <TableHead key={c} className="px-4 text-muted-foreground">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.numarComanda} className="hover:bg-gray-100">
                <TableCell className="px-4 py-3 font-medium text-foreground">
                  {o.numarComanda}
                </TableCell>
                <TableCell className="px-4 py-3 text-foreground">
                  {o.piesa}
                </TableCell>
                <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {o.serieSasiu}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell className="px-4 py-3 text-foreground">
                  {o.timpLivrare}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
