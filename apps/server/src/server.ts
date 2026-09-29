import { createLabRuntime, type LabRuntimeOptions } from "@pico/lab";
import { createApi } from "@/server/http/api";
import { errorResponse } from "@/server/http/responses";

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
          .withOperation(() => api(request))
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
