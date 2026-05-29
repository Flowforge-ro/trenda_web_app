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
    },
  },
});
