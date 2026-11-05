import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The backend `make dev` starts alongside Vite.
const backend = `http://127.0.0.1:${process.env.BACKEND_PORT ?? 8000}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clerkEnvPath = path.join(repoRoot, ".clerk.env");
const clerkEnv = existsSync(clerkEnvPath) ? parse(readFileSync(clerkEnvPath)) : {};
const clerkPublishableKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY || clerkEnv.VITE_CLERK_PUBLISHABLE_KEY || clerkEnv.CLERK_PUBLISHABLE_KEY || "";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Only the publishable key is injected into browser code; CLERK_SECRET_KEY remains server-side.
  define: { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPublishableKey) },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["tailscale-ab1d4949fd25.tailebcd92.ts.net", "ai-clipper.sistems.web.id"],
    proxy: {
      "/api": backend,
      "/media": backend,
    },
  },
});
