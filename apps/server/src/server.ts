import { createHash } from "node:crypto";
import { createLabRuntime, type LabRuntimeOptions } from "@pico/lab";
import { createApi } from "@/server/http/api";
import { browserPolicy } from "@/server/http/browser-policy";
import { errorResponse } from "@/server/http/responses";

async function conditionalResponse(request: Request, response: Response) {
  browserPolicy(response);
  if (
    request.method !== "GET" ||
    response.status !== 200 ||
    !response.headers.get("Content-Type")?.includes("application/json")
  )
    return response;
  const bytes = await response.arrayBuffer();
  const tag = `"${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}"`;
  const headers = new Headers(response.headers);
  headers.set("ETag", tag);
  headers.set("Cache-Control", "private, no-cache");
  if (
    request.headers
      .get("If-None-Match")
      ?.split(",")
      .map((value) => value.trim())
      .includes(tag)
  )
    return new Response(null, { status: 304, headers });
  return new Response(bytes, { status: response.status, headers });
}

/** HTTP composition; callers use the lab's public capabilities or requests. */
export async function createServerApplication(options: LabRuntimeOptions) {
  const runtime = createLabRuntime(options);
  await runtime.start();
  const api = createApi(runtime);
  let closing: Promise<void> | undefined;
  let accepting = true;
  const pending = new Set<Promise<Response>>();
  return {
    runtime,
    fetch(request: Request): Promise<Response> {
      if (!accepting)
        return Promise.resolve(
          Response.json(
            {
              error: { code: "UNAVAILABLE", message: "Pico is shutting down" },
            },
            { status: 503 },
          ),
        );
      try {
        const operation = runtime
          .withOperation(async () =>
            conditionalResponse(request, await api(request)),
          )
          .finally(() => pending.delete(operation));
        pending.add(operation);
        return operation;
      } catch (error) {
        return Promise.resolve(errorResponse(error));
      }
    },
    close(): Promise<void> {
      accepting = false;
      closing ??= (async () => {
        const stopping = runtime.close();
        await Promise.allSettled([...pending, stopping]);
        await stopping;
      })();
      return closing;
    },
  };
}
