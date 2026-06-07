import { z } from "zod";

const graphUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string(),
});
type GraphUser = z.infer<typeof graphUserSchema>;

export async function getGraphUser(accessToken: string): Promise<GraphUser> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph /me failed: ${res.status} ${body}`);
  }
  return graphUserSchema.parse(await res.json());
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
}

const GRAPH_SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
});

export async function getAccessTokenFromRefreshToken(
  refreshToken: string
): Promise<RefreshedToken> {
  const tenant = process.env.ENTRA_TENANT_ID!;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.ENTRA_CLIENT_ID!,
        client_secret: process.env.ENTRA_CLIENT_SECRET_VALUE!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: GRAPH_SCOPES,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }
  const data = tokenResponseSchema.parse(await res.json());
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

const draftSchema = z.object({
  id: z.string(),
  internetMessageId: z.string(),
});

export async function createAndSendMail(
  accessToken: string,
  mail: MailInput
): Promise<{ internetMessageId: string }> {
  const auth = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const draftRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      subject: mail.subject,
      body: { contentType: "Text", content: mail.body },
      toRecipients: [{ emailAddress: { address: mail.to } }],
    }),
  });
  if (!draftRes.ok) {
    throw new Error(`Graph draft failed: ${draftRes.status} ${await draftRes.text()}`);
  }
  const draft = draftSchema.parse(await draftRes.json());

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!sendRes.ok) {
    const detail = `${sendRes.status} ${await sendRes.text()}`;
    // Best-effort cleanup so a failed send doesn't leave an orphan draft.
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
    throw new Error(`Graph send failed: ${detail}`);
  }

  return { internetMessageId: draft.internetMessageId };
}

const graphHeaderSchema = z.object({ name: z.string(), value: z.string() });

const graphMessageSchema = z.object({
  id: z.string(),
  internetMessageId: z.string().nullable().optional(),
  internetMessageHeaders: z.array(graphHeaderSchema).optional(),
  from: z
    .object({ emailAddress: z.object({ address: z.string() }) })
    .nullable()
    .optional(),
  subject: z.string().nullable().optional(),
  receivedDateTime: z.string(),
  hasAttachments: z.boolean().optional(),
  bodyPreview: z.string().optional(),
  body: z.object({ contentType: z.string(), content: z.string() }).optional(),
});

const graphMessagesResponseSchema = z.object({ value: z.array(graphMessageSchema) });

export type GraphMessage = z.infer<typeof graphMessageSchema>;

export async function listMessagesSince(
  accessToken: string,
  sinceIso: string
): Promise<GraphMessage[]> {
  // Build the query manually: URLSearchParams encodes spaces as "+", which Graph's
  // OData $filter parser rejects. encodeURIComponent gives %20 and leaves "$" literal.
  const select =
    "id,internetMessageId,internetMessageHeaders,from,subject,receivedDateTime,hasAttachments,bodyPreview,body";
  // $top=50 with no @odata.nextLink paging: a single 5-minute poll window for one
  // mailbox will not exceed this. Revisit if polling ever spans long gaps.
  const query =
    `$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$top=50` +
    `&$select=${encodeURIComponent(select)}`;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?${query}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Graph list messages failed: ${res.status} ${await res.text()}`);
  }
  return graphMessagesResponseSchema.parse(await res.json()).value;
}

const graphAttachmentSchema = z.object({
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  contentBytes: z.string().optional(),
});

const graphAttachmentsResponseSchema = z.object({
  value: z.array(graphAttachmentSchema),
});

export interface FileAttachment {
  name: string;
  contentType: string | null;
  bytes: Uint8Array;
}

export async function listFileAttachments(
  accessToken: string,
  messageId: string
): Promise<FileAttachment[]> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph list attachments failed: ${res.status} ${await res.text()}`);
  }
  const { value } = graphAttachmentsResponseSchema.parse(await res.json());
  const files: FileAttachment[] = [];
  for (const att of value) {
    if (!att.contentBytes) continue;
    files.push({
      name: att.name ?? "attachment",
      contentType: att.contentType ?? null,
      bytes: new Uint8Array(Buffer.from(att.contentBytes, "base64")),
    });
  }
  return files;
}

const graphAttachmentMetaSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
});

const graphAttachmentMetaResponseSchema = z.object({
  value: z.array(graphAttachmentMetaSchema),
});

export interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
}

export async function listAttachmentMeta(
  accessToken: string,
  messageId: string
): Promise<AttachmentMeta[]> {
  const select = encodeURIComponent("id,name,contentType,size");
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments?$select=${select}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph list attachment meta failed: ${res.status} ${await res.text()}`);
  }
  const { value } = graphAttachmentMetaResponseSchema.parse(await res.json());
  return value.map((a) => ({
    id: a.id,
    name: a.name ?? "attachment",
    contentType: a.contentType ?? null,
    size: a.size ?? null,
  }));
}

export async function getAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<FileAttachment> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Graph get attachment failed: ${res.status} ${await res.text()}`);
  }
  const att = graphAttachmentSchema.parse(await res.json());
  if (!att.contentBytes) {
    throw new Error("Graph attachment has no content bytes");
  }
  return {
    name: att.name ?? "attachment",
    contentType: att.contentType ?? null,
    bytes: new Uint8Array(Buffer.from(att.contentBytes, "base64")),
  };
}
