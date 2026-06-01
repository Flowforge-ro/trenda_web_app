import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENTRA_TENANT_ID ??= "test-tenant";
process.env.ENTRA_CLIENT_ID ??= "test-client-id";
process.env.ENTRA_CLIENT_SECRET_VALUE ??= "test-secret";

import { getAccessTokenFromRefreshToken, createAndSendMail } from "./microsoft.js";

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
