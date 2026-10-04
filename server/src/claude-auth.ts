import { tmpdir } from "node:os";
import {
  type AccountInfo,
  type ModelInfo,
  type Query,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ModelSummary } from "./contracts";

/** Anything that would make Claude Code bill per use instead of the plan.
 *  Removed from every subprocess environment; there is no opt-out. */
export const paidRoutes = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** The fake Messages API of the test harness. Refused outside bun test. */
export function fakeModelUrl(): string | undefined {
  const value = process.env.PICO_TEST_FAKE_MODEL;
  if (process.env.NODE_ENV !== "test") {
    if (value)
      throw new Error("PICO_TEST_FAKE_MODEL is only accepted by bun test");
    return undefined;
  }
  if (!value)
    throw new Error("Tests must use the fake model (PICO_TEST_FAKE_MODEL)");
  if (new URL(value).hostname !== "127.0.0.1")
    throw new Error("PICO_TEST_FAKE_MODEL must point to 127.0.0.1");
  return value;
}

/** The complete environment for a Claude Code subprocess: Pico's private
 *  profile and no credential or route that charges per use. */
export function claudeEnv(
  configDir: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of paidRoutes) delete env[name];
  delete env.PICO_TEST_FAKE_MODEL;
  env.CLAUDE_CONFIG_DIR = configDir;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "pico";
  const fake = fakeModelUrl();
  if (fake) {
    env.ANTHROPIC_BASE_URL = fake;
    env.ANTHROPIC_API_KEY = "test";
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }
  return env;
}

/** Transcripts are read in this process, which must see the same profile. */
export function useClaudeConfigDir(configDir: string): void {
  process.env.CLAUDE_CONFIG_DIR = configDir;
}

/** Why an account is not a Claude subscription login, or null when it is. */
export function subscriptionProblem(info: AccountInfo): string | null {
  if (info.apiProvider && info.apiProvider !== "firstParty")
    return `Claude Code is using ${info.apiProvider}, not a Claude subscription`;
  if (info.apiKeySource && info.apiKeySource !== "none")
    return `Claude Code is using an API key (${info.apiKeySource}), not a Claude subscription`;
  if (!info.subscriptionType)
    return "Claude Code is not signed in with a Claude subscription";
  return null;
}

/** Starts Claude Code without a prompt, asks it something and closes it.
 *  Nothing is sent to a model. */
async function probe<T>(
  configDir: string,
  ask: (q: Query) => Promise<T>,
): Promise<T> {
  const idle: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      await new Promise<never>(() => {});
    },
  };
  const q = query({
    prompt: idle,
    options: {
      // Outside Pico's folders: the process may outlive close() briefly.
      cwd: tmpdir(),
      env: claudeEnv(configDir),
      settingSources: [],
      tools: [],
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ask(q),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Claude Code did not answer in 60s")),
          60_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    q.close();
  }
}

/** Refuses to continue unless the active login is a Claude subscription. */
export async function verifySubscription(
  configDir: string,
): Promise<AccountInfo> {
  const info = await probe(configDir, (q) => q.accountInfo());
  const problem = subscriptionProblem(info);
  if (problem)
    throw new Error(
      `${problem}. Pico only runs on a Claude subscription: run bun run login.`,
    );
  return info;
}

const fallbackModels: ModelInfo[] = [
  { value: "opus", displayName: "Opus", description: "", supportsEffort: true },
  {
    value: "sonnet",
    displayName: "Sonnet",
    description: "",
    supportsEffort: true,
  },
  { value: "haiku", displayName: "Haiku", description: "" },
];

/** "Sonnet 5.5": the version Claude Code names first in the description. */
function modelName(model: ModelInfo): string {
  const version = model.description.split(" · ")[0]?.trim() ?? "";
  return version.startsWith(model.displayName) ? version : model.displayName;
}

/** Claude models offered by this Claude Code version, as aliases or ids. */
export async function claudeModels(configDir: string): Promise<ModelSummary[]> {
  const models = await probe(configDir, (q) => q.supportedModels()).catch(
    () => fallbackModels,
  );
  return models
    .filter((model) => model.value !== "default")
    .map((model) => ({
      provider: "anthropic",
      id: model.value,
      name: modelName(model),
      reasoning: !!(model.supportsEffort || model.supportsAdaptiveThinking),
      input: ["text", "image"],
      contextWindow: 200_000,
    }));
}
