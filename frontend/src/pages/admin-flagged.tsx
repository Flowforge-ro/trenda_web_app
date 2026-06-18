import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFlaggedOrders, type FlaggedOrder } from "@/lib/flagged-orders";

const columns = ["Organizație", "Comandă", "Piesă", "Semnalat de", "Motiv", "Când", ""];

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("ro-RO") : "—";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-100 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

function FlaggedDetailDialog({ order, onClose }: { order: FlaggedOrder | null; onClose: () => void }) {
  const reply = order?.replies[0];
  return (
    <Dialog open={order !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comandă semnalată — {order?.org.name}</DialogTitle>
        </DialogHeader>
        {order ? (
          <div className="grid gap-5 md:grid-cols-2">
            {/* Source email */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Email primit</h3>
              {reply ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    <div>De la: {reply.fromEmail}</div>
                    <div>Data: {new Date(reply.receivedDateTime).toLocaleString("ro-RO")}</div>
                    {reply.subject ? <div>Subiect: {reply.subject}</div> : null}
                    <div>Atașamente: {reply.hasAttachments ? "da" : "nu"}</div>
                  </div>
                  <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-foreground">
                    {reply.body ?? "(fără text)"}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Niciun email asociat (comandă fără răspuns).</p>
              )}
            </section>

            {/* What the system extracted */}
            <section className="space-y-3">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">Ce a extras sistemul</h3>
                <Field label="Număr comandă" value={order.orderNumber} />
                <Field label="Cod piesă" value={order.partCode} />
                <Field label="Serie șasiu" value={order.chassisSeries} />
                <Field label="Nr. înmatriculare" value={order.registrationNumber} />
                <Field label="Termen livrare (text)" value={order.deliveryTime} />
                <Field
                  label="Fereastră livrare"
                  value={order.deliveryEarliest ? `${fmtDate(order.deliveryEarliest)} – ${fmtDate(order.deliveryLatest)}` : null}
                />
                <Field label="Preț ofertă" value={order.offerPrice} />
                <Field label="Status" value={order.status} />
                <Field label="Status răspuns" value={order.replyStatus} />
                <Field label="Încredere nr. comandă" value={order.orderNumberConfidence} />
                <Field label="Încredere livrare" value={order.deliveryConfidence} />
                {order.reviewReasons ? (
                  <div className="pt-1">
                    <span className="text-xs text-muted-foreground">Motive review</span>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{order.reviewReasons}</p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-error/30 bg-error/5 p-3">
                <h3 className="mb-1 text-sm font-semibold text-error">Semnalare</h3>
                <Field label="Semnalat de" value={order.flaggedBy?.name || order.flaggedBy?.email} />
                <Field label="Când" value={new Date(order.flaggedAt).toLocaleString("ro-RO")} />
                <div className="pt-1">
                  <span className="text-xs text-muted-foreground">Motiv</span>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{order.flagReason || "(fără motiv)"}</p>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function FlaggedOrdersTab() {
  const { data, isLoading, isError } = useFlaggedOrders();
  const [selected, setSelected] = useState<FlaggedOrder | null>(null);

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-foreground">Comenzi semnalate</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Comenzile pe care utilizatorii le-au marcat ca greșite, din toate organizațiile. Apasă „Detalii” pentru
        a vedea emailul primit și ce a extras sistemul.
      </p>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead key={i} className="px-4 py-2 text-xs font-medium text-muted-foreground">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Se încarcă…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-sm text-error">
                  Nu s-au putut încărca comenzile semnalate.
                </TableCell>
              </TableRow>
            ) : !data || data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nicio comandă semnalată.
                </TableCell>
              </TableRow>
            ) : (
              data.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="px-4 py-3 text-foreground">{o.org.name}</TableCell>
                  <TableCell className="px-4 py-3 font-medium text-foreground">{o.orderNumber ?? "—"}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">{o.partCode}</TableCell>
                  <TableCell className="px-4 py-3 text-foreground">
                    {o.flaggedBy?.name || o.flaggedBy?.email || "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 max-w-xs truncate text-foreground" title={o.flagReason ?? undefined}>
                    {o.flagReason ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(o.flaggedAt).toLocaleString("ro-RO")}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelected(o)}>
                      Detalii
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <FlaggedDetailDialog order={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
