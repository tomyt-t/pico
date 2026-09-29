import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@/web",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: "@/server",
        replacement: fileURLToPath(new URL("../server/src", import.meta.url)),
      },
      {
        find: "@/lab",
        replacement: fileURLToPath(
          new URL("../../packages/lab/src", import.meta.url),
        ),
      },
      {
        find: "@/runner",
        replacement: fileURLToPath(
          new URL("../../packages/runner/src", import.meta.url),
        ),
      },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
  build: { outDir: "dist", sourcemap: true },
});
