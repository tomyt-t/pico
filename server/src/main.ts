import { join, resolve, sep } from "node:path";
import { verifySubscription } from "./claude-auth";
import { picoPaths, preparePaths } from "./config";
import { errorMessage } from "./errors";

const port = Number(process.env.PICO_PORT || 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PICO_PORT must be an integer between 0 and 65535");
const hostname = process.env.PICO_HOST || "127.0.0.1";

// Only a Claude subscription login may run Pico's agents; never an API key.
const paths = picoPaths();
preparePaths(paths);
try {
  const account = await verifySubscription(paths.claudeConfigDir);
  console.info(`Claude subscription: ${account.subscriptionType}`);
} catch (error) {
  console.error(`Pico will not start: ${errorMessage(error)}`);
  process.exit(1);
}

const { createApp } = await import("./app");
const app = createApp();
const dist = resolve(
  process.env.PICO_WEB_DIST ?? join(import.meta.dir, "..", "..", "web", "dist"),
);

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function withHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(securityHeaders))
    response.headers.set(name, value);
  return response;
}

const server = Bun.serve({
  hostname,
  port,
  idleTimeout: 255,
  maxRequestBodySize: 64_000_000,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      return app.fetch(request);
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
    if (path !== dist && (await file.exists()))
      return withHeaders(new Response(file));
    const index = Bun.file(join(dist, "index.html"));
    if (await index.exists()) return withHeaders(new Response(index));
    return new Response(
      "Pico API is ready. Run bun run dev and open http://127.0.0.1:5174, or bun run build to serve the UI here.",
    );
  },
});

console.info(
  `Pico ready at ${server.url}\n  data: ${app.paths.dataDir}\n  labs: ${app.paths.labsDir}`,
);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await server.stop();
    await app.close();
    process.exit(0);
  } catch (error) {
    console.error("Pico shutdown failed:", error);
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
