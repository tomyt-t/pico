import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "@/lab/contracts";
import { createPiRuntime, type PiRuntime } from "@/lab/models/pi-runtime";

const directories: string[] = [];
const runtimes: PiRuntime[] = [];
const config: ProviderConfig = {
  mode: "pi",
  provider: "zai",
  model: "glm-5.3",
  thinking: "high",
  baseUrl: "https://unused.example",
  apiKeyEnv: "UNUSED_PICO_TEST_KEY",
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pico-pi-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  return { root, agentDir, cwd };
}
function open(options: Parameters<typeof createPiRuntime>[0]) {
  const runtime = createPiRuntime(options);
  runtimes.push(runtime);
  return runtime;
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("Pi access stays lazy and closes without touching credentials when unused", async () => {
  const { agentDir, cwd } = fixture();
  let calls = 0;
  const runtime = open({
    agentDir,
    cwd,
    runtimeFactory: async () => {
      calls++;
      throw new Error("Must remain lazy");
    },
  });
  expect(calls).toBe(0);
  await runtime.close();
  expect(calls).toBe(0);
  expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
  await expect(runtime.models()).rejects.toThrow("Pi access is closed");
});

test("catalog follows global Pi selection and reports stored credentials without exposing or refreshing them", async () => {
  const { agentDir, cwd } = fixture();
  const authPath = join(agentDir, "auth.json");
  writeFileSync(
    authPath,
    JSON.stringify({
      zai: { type: "api_key", key: "synthetic-private-key" },
      "openai-codex": {
        type: "oauth",
        access: "synthetic-private-access",
        refresh: "synthetic-private-refresh",
        expires: 0,
      },
    }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "zai",
      defaultModel: "glm-5.3",
      defaultThinkingLevel: "high",
    }),
  );
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(
    join(cwd, ".pi/settings.json"),
    JSON.stringify({
      defaultProvider: "untrusted-project-provider",
      defaultModel: "untrusted-model",
    }),
  );
  const original = readFileSync(authPath, "utf8");
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Metadata must not call the network"),
  );
  try {
    const runtime = open({ agentDir, cwd });
    const catalog = await runtime.catalog();
    expect(catalog.defaultSelection).toEqual({
      provider: "zai",
      model: "glm-5.3",
      thinking: "high",
    });
    expect(
      catalog.providers.find((provider) => provider.id === "zai")
        ?.authenticated,
    ).toBe(true);
    expect(
      catalog.providers.find((provider) => provider.id === "openai-codex")
        ?.authenticated,
    ).toBe(true);
    expect(
      catalog.providers
        .find((provider) => provider.id === "zai")
        ?.models.some((model) => model.id === "glm-5.3"),
    ).toBe(true);
    const status = await runtime.status({
      ...config,
      provider: "openai-codex",
      model: "gpt-5.6-sol",
    });
    expect(status.configured).toBe(true);
    expect(status.detail).toContain("next inference");
    expect(JSON.stringify({ catalog, status })).not.toContain(
      "synthetic-private",
    );
    expect(readFileSync(authPath, "utf8")).toBe(original);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test("catalog and status never run stored API-key commands", async () => {
  const { root, agentDir, cwd } = fixture();
  const marker = join(root, "command-was-run");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({ zai: { type: "api_key", key: `!touch ${marker}` } }),
  );
  const runtime = open({ agentDir, cwd });
  expect(
    (await runtime.catalog()).providers.find(
      (provider) => provider.id === "zai",
    )?.authenticated,
  ).toBe(true);
  expect((await runtime.status(config)).configured).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("custom Pi models are included without serializing their API keys or headers", async () => {
  const { agentDir, cwd } = fixture();
  writeFileSync(join(agentDir, "auth.json"), "{}");
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "custom-pi": {
          baseUrl: "https://model.example/v1",
          api: "openai-completions",
          apiKey: "synthetic-custom-key",
          headers: { Authorization: "synthetic-custom-header" },
          models: [
            {
              id: "local-model",
              name: "Local model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 4096,
              maxTokens: 512,
            },
          ],
        },
      },
    }),
  );
  const runtime = open({ agentDir, cwd });
  const catalog = await runtime.catalog();
  const provider = catalog.providers.find((item) => item.id === "custom-pi");
  expect(provider?.authenticated).toBe(true);
  expect(provider?.models[0]?.id).toBe("local-model");
  expect(JSON.stringify(catalog)).not.toContain("synthetic-custom");
  expect(
    (
      await runtime.status({
        ...config,
        provider: "custom-pi",
        model: "local-model",
      })
    ).configured,
  ).toBe(true);
});

test("invalid configured models are rejected and Pi failures are sanitized and retryable", async () => {
  const { agentDir, cwd } = fixture();
  writeFileSync(join(agentDir, "auth.json"), "{}");
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ defaultProvider: "zai", defaultModel: "retired-model" }),
  );
  let attempts = 0;
  const runtime = open({
    agentDir,
    cwd,
    runtimeFactory: async (options) => {
      if (++attempts === 1)
        throw new Error("Private credential synthetic-sensitive-response");
      return ModelRuntime.create(options);
    },
  });
  const first = await runtime.catalog();
  expect(first.warning).toContain("Pi configuration could not be loaded");
  expect(JSON.stringify(first)).not.toContain("synthetic-sensitive-response");
  const second = await runtime.catalog();
  expect(second.defaultSelection).toBeNull();
  expect(second.warning).toContain("not in the current Pi catalog");
  expect(
    (await runtime.status({ ...config, model: "retired-model" })).configured,
  ).toBe(false);
  expect(attempts).toBe(2);
});

test("concurrent callers share initialization and close awaits admitted metadata work", async () => {
  const { agentDir, cwd } = fixture();
  writeFileSync(join(agentDir, "auth.json"), "{}");
  const instance = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let signal: AbortSignal | undefined;
  const runtime = open({
    agentDir,
    cwd,
    runtimeFactory: async (options) => {
      calls++;
      signal = options.signal;
      await barrier;
      return instance;
    },
  });
  const first = runtime.models();
  const second = runtime.models();
  await Promise.resolve();
  expect(calls).toBe(1);
  let completed = false;
  const closing = runtime.close().then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(signal?.aborted).toBe(true);
  release?.();
  expect(await first).toBe(instance);
  expect(await second).toBe(instance);
  await closing;
  await expect(runtime.catalog()).rejects.toThrow("Pi access is closed");
});
