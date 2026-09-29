import { z } from "zod";
import type {
  JsonObject,
  ProviderConfig,
  ProviderStatus,
} from "@/lab/contracts";
import type { ModelAdapter, ModelCall } from "@/lab/models/model-contract";
import {
  isContextOverflow,
  ModelContextOverflow,
  ModelResponseError,
} from "@/lab/models/model-contract";

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.literal("function"),
                function: z.object({
                  name: z.string().min(1),
                  arguments: z.string(),
                }),
              }),
            )
            .max(20)
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.record(z.string(), z.json()).optional(),
});

export function providerStatus(config: ProviderConfig): ProviderStatus {
  const configured =
    config.mode === "demo" || Boolean(process.env[config.apiKeyEnv]);
  return {
    mode: config.mode,
    model: config.model,
    configured,
    detail:
      config.mode === "demo"
        ? "Simulated conversation; local experiment execution is real."
        : configured
          ? "Credential available on the server. Connection has not been tested."
          : `Set ${config.apiKeyEnv} in the server environment and restart Pico.`,
  };
}

/** Chat Completions compatible protocol; credentials never enter records or browser responses. */
export const complete: ModelAdapter = async ({
  config,
  messages,
  tools,
  signal,
}) => {
  const key = process.env[config.apiKeyEnv];
  if (!key)
    throw new Error(`Server credential ${config.apiKeyEnv} is not configured`);
  const endpoint = new URL(config.baseUrl);
  if (endpoint.search || endpoint.hash)
    throw new Error(
      "Model endpoints cannot contain query parameters or fragments; configure credentials with an environment variable",
    );
  const url = new URL(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error("Model endpoints require HTTPS, except on localhost");
  }
  if (url.username || url.password)
    throw new Error(
      "Put model credentials in the configured environment variable",
    );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(
        ({
          native: _native,
          images: _images,
          timestamp: _timestamp,
          tool_name: _name,
          isError: _isError,
          ...message
        }) => message,
      ),
      tools: tools.map((tool) => ({ type: "function", function: tool })),
      parallel_tool_calls: false,
      stream: false,
    }),
  });
  // An upstream error can echo request headers. Do not persist an arbitrary upstream body.
  if (!response.ok) {
    // Classification only: no upstream text, headers or credentials are retained.
    if ([400, 413, 422].includes(response.status)) {
      const reader = response.body?.getReader();
      let sample = "";
      if (reader) {
        while (sample.length < 16_000) {
          const { value, done } = await reader.read();
          if (done) break;
          sample += new TextDecoder().decode(
            value.subarray(0, 16_000 - sample.length),
          );
        }
        await reader.cancel();
      }
      if (isContextOverflow(sample)) throw new ModelContextOverflow();
    }
    throw new Error(`Model provider returned HTTP ${response.status}`);
  }
  let parsed: z.infer<typeof completionSchema>;
  try {
    parsed = completionSchema.parse(await response.json());
  } catch {
    throw new Error(
      "Model provider returned an invalid response; upstream response text was not retained",
    );
  }
  const choice = parsed.choices[0];
  if (!choice) throw new Error("Model provider returned no choices");
  if (choice.finish_reason === "length")
    throw new ModelResponseError(
      "Model output was truncated; increase the provider output limit",
      parsed.usage as JsonObject | undefined,
    );
  let calls: ModelCall[];
  try {
    calls = (choice.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: z
        .record(z.string(), z.json())
        .parse(JSON.parse(call.function.arguments)) as JsonObject,
    }));
  } catch {
    throw new ModelResponseError(
      "Model provider returned invalid tool arguments; no tool was executed",
      parsed.usage as JsonObject | undefined,
    );
  }
  if (new Set(calls.map((call) => call.id)).size !== calls.length)
    throw new ModelResponseError(
      "Model returned duplicate tool call identifiers",
      parsed.usage as JsonObject | undefined,
    );
  return {
    content: choice.message.content ?? choice.message.refusal ?? "",
    calls,
    usage: parsed.usage as JsonObject | undefined,
  };
};
