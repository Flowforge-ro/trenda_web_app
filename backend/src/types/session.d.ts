import "@fastify/secure-session";

declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;
    /** sessionVersion at login; sessions older than the user's current version are rejected. */
    sv: number;
    pendingMailboxType: string;
  }
}
