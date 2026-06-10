import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";

import { getAccessTokenFromRefreshToken, createAndSendMail, listMessagesSince, listFileAttachments, listAttachmentMeta, getAttachmentBytes } from "./microsoft.js";

afterEach(() => mock.restoreAll());

test("getAccessTokenFromRefreshToken returns access + rotated refresh token", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ access_token: "AT", refresh_token: "RT2" }),
      { status: 200 }
    )
  );

  const result = await getAccessTokenFromRefreshToken("RT1");

  assert.equal(result.accessToken, "AT");
  assert.equal(result.refreshToken, "RT2");
  const url = fetchMock.mock.calls[0].arguments[0] as string;
  assert.ok(url.includes("test-tenant/oauth2/v2.0/token"), `url was ${url}`);
});

test("getAccessTokenFromRefreshToken throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response("nope", { status: 400 })
  );
  await assert.rejects(() => getAccessTokenFromRefreshToken("RT1"), /token refresh failed/i);
});

test("createAndSendMail drafts then sends and returns internetMessageId", async () => {
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/me/messages")) {
      return new Response(
        JSON.stringify({ id: "MSG1", internetMessageId: "<abc@contoso>" }),
        { status: 201 }
      );
    }
    return new Response(null, { status: 202 }); // /send
  });

  const result = await createAndSendMail("AT", {
    to: "f@ex.ro",
    subject: "S",
    body: "B",
  });

  assert.equal(result.internetMessageId, "<abc@contoso>");
  assert.ok(calls[0].endsWith("/me/messages"));
  assert.ok(calls[1].endsWith("/me/messages/MSG1/send"));
});

test("createAndSendMail throws and deletes the draft when send fails", async () => {
  const calls: { url: string; method?: string }[] = [];
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    if (url.endsWith("/me/messages")) {
      return new Response(
        JSON.stringify({ id: "MSG1", internetMessageId: "<x>" }),
        { status: 201 }
      );
    }
    return new Response("boom", { status: 500 });
  });
  await assert.rejects(
    () => createAndSendMail("AT", { to: "f@ex.ro", subject: "S", body: "B" }),
    /send failed/i
  );
  assert.ok(
    calls.some((c) => c.url.endsWith("/me/messages/MSG1") && c.method === "DELETE"),
    "expected orphan draft to be deleted"
  );
});

test("listMessagesSince requests the filter window and returns parsed messages", async () => {
  let calledUrl = "";
  let prefer = "";
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calledUrl = url;
    prefer = (init?.headers as Record<string, string>)?.Prefer ?? "";
    return new Response(
      JSON.stringify({
        value: [
          {
            id: "MSG1",
            internetMessageId: "<reply@contoso>",
            internetMessageHeaders: [
              { name: "In-Reply-To", value: "<orig@us>" },
            ],
            from: { emailAddress: { address: "supplier@ex.ro" } },
            subject: "Re: Cerere",
            receivedDateTime: "2026-06-01T10:00:00Z",
            hasAttachments: false,
            body: { contentType: "text", content: "Comanda 42" },
          },
        ],
      }),
      { status: 200 }
    );
  });

  const msgs = await listMessagesSince("AT", "2026-06-01T09:00:00Z");

  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].id, "MSG1");
  assert.equal(msgs[0].from?.emailAddress.address, "supplier@ex.ro");
  assert.ok(calledUrl.includes("receivedDateTime%20ge%202026-06-01T09%3A00%3A00Z"), `url was ${calledUrl}`);
  assert.ok(calledUrl.includes("$select="), "expected a $select clause");
  assert.equal(prefer, 'outlook.body-content-type="text"');
});

test("listMessagesSince throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 401 }));
  await assert.rejects(() => listMessagesSince("AT", "2026-06-01T09:00:00Z"), /list messages failed/i);
});

test("listFileAttachments returns every file attachment, base64-decoded", async () => {
  const aB64 = Buffer.from("pdf-bytes").toString("base64");
  const bB64 = Buffer.from("png-bytes").toString("base64");
  let calledUrl = "";
  mock.method(globalThis, "fetch", async (url: string) => {
    calledUrl = url;
    return new Response(
      JSON.stringify({
        value: [
          { name: "doc.pdf", contentType: "application/pdf", contentBytes: aB64 },
          { name: "photo.png", contentType: "image/png", contentBytes: bB64 },
          { name: "no-bytes.txt", contentType: "text/plain" },
        ],
      }),
      { status: 200 }
    );
  });

  const atts = await listFileAttachments("AT", "MSG1");

  assert.equal(atts.length, 2);
  assert.equal(atts[0].name, "doc.pdf");
  assert.equal(atts[0].contentType, "application/pdf");
  assert.equal(Buffer.from(atts[0].bytes).toString(), "pdf-bytes");
  assert.equal(atts[1].name, "photo.png");
  assert.ok(calledUrl.endsWith("/me/messages/MSG1/attachments"), `url was ${calledUrl}`);
});

test("listFileAttachments throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 404 }));
  await assert.rejects(() => listFileAttachments("AT", "MSG1"), /list attachments failed/i);
});

test("listAttachmentMeta returns metadata without content bytes", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        value: [
          { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 1234 },
          { id: "A2", name: null, contentType: null },
        ],
      }),
      { status: 200 }
    )
  );

  const result = await listAttachmentMeta("AT", "MSG1");

  assert.deepEqual(result, [
    { id: "A1", name: "po.pdf", contentType: "application/pdf", size: 1234 },
    { id: "A2", name: "attachment", contentType: null, size: null },
  ]);
  const url = fetchMock.mock.calls[0].arguments[0] as string;
  assert.ok(url.includes("/me/messages/MSG1/attachments"), `url was ${url}`);
  assert.ok(new URL(url).searchParams.has("$select"), `expected $select param in ${url}`);
});

test("listAttachmentMeta throws on HTTP error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }));
  await assert.rejects(() => listAttachmentMeta("AT", "MSG1"), /list attachment meta failed/i);
});

test("getAttachmentBytes decodes base64 content", async () => {
  const b64 = Buffer.from("hello").toString("base64");
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({ name: "po.pdf", contentType: "application/pdf", contentBytes: b64 }),
      { status: 200 }
    )
  );

  const result = await getAttachmentBytes("AT", "MSG1", "A1");

  assert.equal(result.name, "po.pdf");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(Buffer.from(result.bytes).toString(), "hello");
});

test("getAttachmentBytes throws when no content bytes", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ name: "x", contentType: "text/plain" }), { status: 200 })
  );
  await assert.rejects(() => getAttachmentBytes("AT", "MSG1", "A1"), /no content bytes/i);
});
