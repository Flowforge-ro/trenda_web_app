import "@fastify/secure-session";

declare module "@fastify/secure-session" {
  interface SessionData {
    oauth_state: string;
    userId: string;
  }
}
