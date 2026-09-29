import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const dataDir = resolve(
  process.env.PICO_DATA_DIR || join(homedir(), ".local", "share", "pico"),
);
const port = Number(process.env.PICO_PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PICO_PORT must be an integer between 0 and 65535");
// Bun --watch sends SIGTERM on every edit, including edits during bootstrap.
// Install handlers before loading the provider SDK so a rapid second edit cannot
// terminate the watcher before the application is ready to handle signals.
let shutdownRequested = false;
let shutdownReady: (() => Promise<void>) | undefined;
const receiveShutdown = () => {
  shutdownRequested = true;
  void shutdownReady?.();
};
process.on("SIGINT", receiveShutdown);
process.on("SIGTERM", receiveShutdown);
const { createServerApplication } = await import("@/server/server");
const application = await createServerApplication({ dataDir });
const dist = resolve(
  process.env.PICO_WEB_DIST ?? resolve(import.meta.dir, "../../web/dist"),
);
let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: 16_000_000,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
        return application.fetch(request);
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405 });
      let path: string;
      try {
        path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      } catch {
        return new Response("Invalid path", { status: 400 });
      }
      if (path !== dist && !path.startsWith(`${dist}${sep}`))
        return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (path !== dist && (await file.exists())) return new Response(file);
      const index = Bun.file(join(dist, "index.html"));
      if (await index.exists()) return new Response(index);
      return new Response(
        "Pico API is ready. Run bun run dev and open http://127.0.0.1:5174, or bun run build to serve the UI here.",
      );
    },
  });
} catch (error) {
  await application.close();
  throw error;
}
console.info(`Pico ready at ${server.url}; research stored in ${dataDir}`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    // Active HTTP metadata requests may need the application's abort to
    // complete. Start both shutdowns before waiting for either owner.
    const outcomes = await Promise.allSettled([
      server.stop(),
      application.close(),
    ]);
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    process.exit(0);
  } catch (error) {
    console.error(
      "Pico shutdown failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
shutdownReady = shutdown;
if (shutdownRequested) await shutdown();
