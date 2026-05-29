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
