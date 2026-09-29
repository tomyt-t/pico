import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pico-pi-refresh-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "auth.json"), "{}");
  return { root, agentDir };
}
function customModels(apiKey: string, id = "first-model") {
  return {
    providers: {
      "refresh-test": {
        baseUrl: "https://synthetic.invalid/v1",
        api: "openai-completions",
        apiKey,
        models: [
          {
            id,
            name: id,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 4096,
            maxTokens: 512,
          },
        ],
      },
    },
  };
}
function config(provider: string, model: string): ProviderConfig {
  return {
    mode: "pi",
    provider,
    model,
    baseUrl: "",
    apiKeyEnv: "UNUSED_TEST_KEY",
  };
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("catalog reloads local model additions, changes and removals without commands or network", async () => {
  const { root, agentDir } = fixture();
  const marker = join(root, "command-ran");
  let creations = 0;
  const runtime = createPiRuntime({
    agentDir,
    cwd: root,
    runtimeFactory: async (options) => {
      creations++;
      expect(options.allowModelNetwork).toBe(false);
      expect(options.refreshOnCreate).toBe(false);
      return ModelRuntime.create(options);
    },
  });
  runtimes.push(runtime);
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected metadata network call"),
  );
  try {
    const original = await runtime.models();
    expect(
      (await runtime.catalog()).providers.some((p) => p.id === "refresh-test"),
    ).toBe(false);
    expect(creations).toBe(1);
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(customModels(`!touch ${marker}`)),
    );
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "refresh-test",
        defaultModel: "first-model",
      }),
    );
    const added = await runtime.catalog();
    expect(
      added.providers.find((p) => p.id === "refresh-test")?.models[0]?.id,
    ).toBe("first-model");
    expect(added.defaultSelection?.model).toBe("first-model");
    expect(
      (await runtime.status(config("refresh-test", "first-model"))).configured,
    ).toBe(true);
    const withFirst = await runtime.models();
    expect(withFirst).not.toBe(original);
    expect(creations).toBe(2);
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(customModels(`!touch ${marker}`, "later-model")),
    );
    expect(
      (await runtime.catalog()).providers.find((p) => p.id === "refresh-test")
        ?.models[0]?.id,
    ).toBe("later-model");
    expect(
      (await runtime.status(config("refresh-test", "first-model"))).configured,
    ).toBe(false);
    expect(
      (await runtime.status(config("refresh-test", "later-model"))).configured,
    ).toBe(true);
    // Existing request owners still hold their original usable model metadata.
    expect(withFirst.getModel("refresh-test", "first-model")?.id).toBe(
      "first-model",
    );
    rmSync(join(agentDir, "models.json"));
    expect(
      (await runtime.catalog()).providers.some((p) => p.id === "refresh-test"),
    ).toBe(false);
    expect(creations).toBe(4);
    expect(network).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);
  } finally {
    network.mockRestore();
  }
});

test("external Pi sign-in and sign-out update readiness without rebuilding models or resolving keys", async () => {
  const { root, agentDir } = fixture();
  const marker = join(root, "command-ran");
  let creations = 0;
  const runtime = createPiRuntime({
    agentDir,
    cwd: root,
    runtimeFactory: async (options) => {
      creations++;
      return ModelRuntime.create(options);
    },
  });
  runtimes.push(runtime);
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected metadata network call"),
  );
  const oldKey = process.env.ZAI_API_KEY;
  delete process.env.ZAI_API_KEY;
  try {
    const selected = config("zai", "glm-5.3");
    expect((await runtime.status(selected)).configured).toBe(false);
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({ zai: { type: "api_key", key: `!touch ${marker}` } }),
    );
    expect((await runtime.status(selected)).configured).toBe(true);
    expect(
      (await runtime.catalog()).providers.find((p) => p.id === "zai")
        ?.authenticated,
    ).toBe(true);
    writeFileSync(join(agentDir, "auth.json"), "{}");
    expect((await runtime.status(selected)).configured).toBe(false);
    expect(creations).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(network).not.toHaveBeenCalled();
  } finally {
    if (oldKey === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = oldKey;
    network.mockRestore();
  }
});
