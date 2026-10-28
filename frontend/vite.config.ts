import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The backend `make dev` starts alongside Vite.
const backend = `http://127.0.0.1:${process.env.BACKEND_PORT ?? 8000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": backend,
      "/media": backend,
    },
  },
});
