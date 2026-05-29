import "@fastify/oauth2";
import type { OAuth2Namespace } from "@fastify/oauth2";

declare module "fastify" {
  interface FastifyInstance {
    microsoftOAuth2: OAuth2Namespace;
  }
}
