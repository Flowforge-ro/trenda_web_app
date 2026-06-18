/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Proxy backend routes so the browser only ever talks to this origin.
  // This keeps the auth session cookie first-party (SameSite=Lax works in all browsers).
  server: {
    proxy: {
      "/auth": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/orders": "http://localhost:3000",
      "/mailboxes": "http://localhost:3000",
      "/organizations": "http://localhost:3000",
      "/users": "http://localhost:3000",
      "/logs": "http://localhost:3000",
      "/appointments": "http://localhost:3000",
      "/usage": "http://localhost:3000"
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
