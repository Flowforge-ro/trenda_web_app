import { attachmentUrl, type OrderReview, type ReviewAttachment } from "@/lib/orders";

function AttachmentView({ orderId, att }: { orderId: string; att: ReviewAttachment }) {
  const url = attachmentUrl(orderId, att.id);
  const type = att.contentType ?? "";
  return (
    <div className="rounded-md border border-gray-200 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{att.name}</span>
        <div className="flex shrink-0 items-center gap-3">
          {type === "application/pdf" ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              Deschide în tab nou
            </a>
          ) : null}
          <a href={url} download={att.name} className="text-xs text-primary underline">
            Descarcă
          </a>
        </div>
      </div>
      {type === "application/pdf" ? (
        <iframe src={url} title={att.name} className="h-[32rem] w-full rounded border border-gray-200" />
      ) : type.startsWith("image/") ? (
        <img src={url} alt={att.name} className="max-h-96 w-auto" />
      ) : null}
    </div>
  );
}

export function OfferReplyView({ orderId, data }: { orderId: string; data: OrderReview }) {
  return (
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
            <AttachmentView key={att.id} orderId={orderId} att={att} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
