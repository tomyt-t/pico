/** Single inference, no agent loop, extensions, tools, or automatic retry. */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function validateRequest(value) {
  if (
    value?.schema_version !== 1 ||
    value.sdk_version !== "0.86.1" ||
    value.provider !== "zai" ||
    value.model !== "glm-5.3-flash" ||
    value.thinking !== "off" ||
    value.max_retries !== 0 ||
    value.timeout_ms !== 60000 ||
    value.max_tokens !== 64 ||
    value.temperature !== 0 ||
    typeof value.system_prompt !== "string" ||
    !value.system_prompt.trim() ||
    typeof value.question !== "string" ||
    !value.question.trim() ||
    typeof value.image_base64 !== "string" ||
    !value.image_base64 ||
    value.image_base64.length > 2_000_000
  )
    throw new Error("invalid_request");
  return value;
}

export async function infer(request, { createRuntime, version } = {}) {
  const input = validateRequest(request);
  if (!createRuntime) {
    const sdk = await import("@earendil-works/pi-coding-agent");
    createRuntime = sdk.ModelRuntime.create;
    version ??= sdk.VERSION;
  }
  if (version !== input.sdk_version) throw new Error("sdk_version_mismatch");
  const signal = AbortSignal.timeout(input.timeout_ms);
  const profile = resolve(
    process.env.PICO_PI_AGENT_DIR ??
      join(
        process.env.PICO_DATA_DIR ?? join(homedir(), ".local/share/pico"),
        "pi",
      ),
  );
  const runtime = await createRuntime({
    authPath: join(profile, "auth.json"),
    modelsStorePath: join(profile, "models-store.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
    signal,
  });
  const model = runtime.getModel(input.provider, input.model);
  if (!model?.input.includes("image"))
    throw new Error("image_model_unavailable");
  const started = performance.now();
  const reply = await runtime.completeSimple(
    model,
    {
      systemPrompt: input.system_prompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: input.image_base64 },
            { type: "text", text: input.question },
          ],
          timestamp: Date.now(),
        },
      ],
      tools: [],
    },
    {
      signal,
      timeoutMs: input.timeout_ms,
      maxRetries: 0,
      // In Pi's simple options, omitted reasoning disables ZAI thinking.
      temperature: input.temperature,
      maxTokens: input.max_tokens,
      cacheRetention: "none",
    },
  );
  // Do not serialize SDK errorMessage/cause or raw transport payloads: they may
  // contain upstream diagnostics. A failed call still fails the entire run.
  const toolCalls = reply.content.some((part) => part.type === "toolCall");
  const text = reply.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  return {
    schema_version: 1,
    success: reply.stopReason === "stop" && !toolCalls && Boolean(text.trim()),
    tool_calls: toolCalls,
    text,
    stop_reason: reply.stopReason,
    provider: reply.provider,
    model: reply.model,
    api: reply.api,
    ...(reply.responseModel ? { response_model: reply.responseModel } : {}),
    ...(reply.providerThinkingLevel
      ? { provider_thinking_level: reply.providerThinkingLevel }
      : {}),
    usage: reply.usage,
    sdk_version: version,
    latency_ms: performance.now() - started,
  };
}

if (import.meta.main) {
  try {
    const input = await Bun.stdin.text();
    if (input.length > 2_100_000) throw new Error("request_too_large");
    process.stdout.write(`${JSON.stringify(await infer(JSON.parse(input)))}\n`);
  } catch {
    process.stderr.write(
      "Pi inference failed; no aggregate metrics will be published.\n",
    );
    process.exitCode = 1;
  }
}
