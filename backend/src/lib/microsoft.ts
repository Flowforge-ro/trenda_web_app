interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}

export async function getGraphUser(accessToken: string): Promise<GraphUser> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph /me failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<GraphUser>;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
}

const GRAPH_SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send";

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
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

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
  const draft = (await draftRes.json()) as {
    id: string;
    internetMessageId: string;
  };

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
