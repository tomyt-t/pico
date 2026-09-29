import { cleanupSessionResources } from "@earendil-works/pi-ai";
import type { ModelAccess, ModelAdapter } from "@/lab/models/model-contract";
import { providerStatus } from "@/lab/models/openai-compatible";
import { createPiAdapter } from "@/lab/models/pi-adapter";
import { createPiRuntime, type PiRuntime } from "@/lab/models/pi-runtime";

export type { ModelAccess } from "@/lab/models/model-contract";
export { replayEntries, replayGroups } from "@/lab/models/pi-adapter";

export function createModelGateway(options: {
  agentDir: string;
  adapter?: ModelAdapter;
  pi?: PiRuntime;
}): ModelAccess {
  const pi = options.pi ?? createPiRuntime({ agentDir: options.agentDir });
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  return {
    complete: options.adapter ?? createPiAdapter(pi),
    catalog: () => pi.catalog(),
    status: (config) => pi.status(config),
    test(config) {
      if (controller.signal.aborted)
        return Promise.reject(new Error("Model access is closed"));
      const operation = (async () => {
        if (config.mode === "pi") return pi.status(config);
        const status = providerStatus(config);
        if (config.mode === "demo" || !status.configured) return status;
        const endpoint = new URL(`${config.baseUrl.replace(/\/$/, "")}/models`);
        if (
          (endpoint.protocol !== "https:" &&
            !(
              endpoint.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
            )) ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash
        )
          throw new Error(
            "Provider endpoints require HTTPS except on localhost; credentials belong in the server environment",
          );
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${process.env[config.apiKeyEnv]}` },
          redirect: "error",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        return {
          ...status,
          configured: response.ok,
          detail: response.ok
            ? "Provider responded successfully. Generation and model availability are verified when you chat."
            : `Provider returned HTTP ${response.status}.`,
        };
      })().finally(() => pending.delete(operation));
      pending.add(operation);
      return operation;
    },
    async close() {
      controller.abort();
      await Promise.allSettled([pi.close(), ...pending]);
    },
    releaseSession: cleanupSessionResources,
  };
}

export { complete } from "@/lab/models/openai-compatible";
