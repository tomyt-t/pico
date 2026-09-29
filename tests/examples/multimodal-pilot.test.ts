import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve(import.meta.dir, "../../examples/multimodal-defense");
const launcherPath = pathToFileURL(resolve(directory, "launcher.mjs")).href;
const { infer } = (await import(launcherPath)) as {
  infer(
    request: Record<string, unknown>,
    options: {
      createRuntime: (options: Record<string, unknown>) => Promise<unknown>;
      version?: string;
    },
  ): Promise<Record<string, unknown>>;
};
const config = JSON.parse(
  readFileSync(resolve(directory, "config.baseline.json"), "utf8"),
);
const request = {
  ...config,
  system_prompt: "Answer the image question.",
  question:
    "What color is the large rectangle? Reply with exactly RED or BLUE.",
  image_base64: readFileSync(
    resolve(directory, "dataset/sample-01.png"),
  ).toString("base64"),
};
const usage = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("multimodal pilot driver validates scoring, provenance, failure and replay with fake subprocesses", () => {
  const output = execFileSync(
    "python3",
    ["-B", resolve(import.meta.dir, "multimodal_pilot_test.py")],
    {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 15_000,
    },
  );
  expect(output).toBe("");
});

test("launcher sends preserved image bytes without labels, retries, reasoning or tools", async () => {
  const calls: {
    context: Record<string, unknown>;
    options: Record<string, unknown>;
  }[] = [];
  const result = await infer(request, {
    version: "0.86.1",
    createRuntime: async (options) => {
      expect(options.modelsPath).toBeNull();
      expect(options.allowModelNetwork).toBe(false);
      expect(options.refreshOnCreate).toBe(false);
      return {
        getModel: () => ({ input: ["text", "image"] }),
        completeSimple: async (
          _model: unknown,
          context: Record<string, unknown>,
          inferenceOptions: Record<string, unknown>,
        ) => {
          calls.push({ context, options: inferenceOptions });
          return {
            stopReason: "stop",
            content: [{ type: "text", text: "RED" }],
            usage,
            provider: "zai",
            model: "glm-5.3-flash",
            api: "openai-completions",
            responseModel: "glm-5.3-flash-202609",
            providerThinkingLevel: "disabled",
          };
        },
      };
    },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options).toMatchObject({
    maxRetries: 0,
    timeoutMs: 60000,
    maxTokens: 64,
    temperature: 0,
    cacheRetention: "none",
  });
  expect(calls[0]?.options.reasoning).toBeUndefined();
  expect(calls[0]?.context.tools).toEqual([]);
  const messages = calls[0]?.context.messages as { content: unknown[] }[];
  expect(messages[0]?.content).toEqual([
    { type: "image", mimeType: "image/png", data: request.image_base64 },
    { type: "text", text: request.question },
  ]);
  expect(JSON.stringify(calls[0]?.context)).not.toContain("dataset_version_id");
  expect(JSON.stringify(calls[0]?.context)).not.toContain("expected");
  expect(result).toMatchObject({
    success: true,
    api: "openai-completions",
    response_model: "glm-5.3-flash-202609",
    provider_thinking_level: "disabled",
    usage,
  });
});

test("launcher preserves incomplete inference usage but omits private SDK diagnostics", async () => {
  const result = await infer(request, {
    version: "0.86.1",
    createRuntime: async () => ({
      getModel: () => ({ input: ["image"] }),
      completeSimple: async () => ({
        stopReason: "length",
        content: [],
        usage,
        provider: "zai",
        model: "glm-5.3-flash",
        api: "openai-completions",
        errorMessage: "SYNTHETIC_SECRET",
        response: { private: "SYNTHETIC_SECRET" },
      }),
    }),
  });
  expect(result).toMatchObject({
    success: false,
    stop_reason: "length",
    usage,
  });
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
});

test("launcher rejects changed SDK version and text-only targets before inference", async () => {
  let called = false;
  const createRuntime = async () => ({
    getModel: () => ({ input: ["text"] }),
    completeSimple: async () => {
      called = true;
    },
  });
  await expect(
    infer(request, { createRuntime, version: "0.86.2" }),
  ).rejects.toThrow("sdk_version_mismatch");
  await expect(
    infer(request, { createRuntime, version: "0.86.1" }),
  ).rejects.toThrow("image_model_unavailable");
  expect(called).toBe(false);
});
