import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeEnv, paidRoutes, subscriptionProblem } from "../src/claude-auth";
import {
  type FakeModel,
  type Sandbox,
  sandbox,
  startFakeModel,
  until,
} from "./support";

let box: Sandbox | undefined;
let fake: FakeModel | undefined;
const saved = { ...process.env };
afterEach(async () => {
  await box?.cleanup();
  fake?.stop();
  box = undefined;
  fake = undefined;
  for (const name of Object.keys(process.env))
    if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

/** Values a researcher might have exported for other tools. */
const researcherRoutes = Object.fromEntries(
  paidRoutes.map((name) => [name, `researcher-${name.toLowerCase()}`]),
);

test("every paid route is removed from the subprocess environment, and only the test harness reaches its local fake", () => {
  Object.assign(process.env, researcherRoutes);
  process.env.PICO_TEST_FAKE_MODEL = "http://127.0.0.1:9";
  const env = claudeEnv("/pico/claude");
  expect(env.CLAUDE_CONFIG_DIR).toBe("/pico/claude");
  for (const name of paidRoutes)
    expect(env[name]).not.toBe(researcherRoutes[name]);
  for (const name of [
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ])
    expect(env[name]).toBeUndefined();
  expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9");
  expect(env.ANTHROPIC_API_KEY).toBe("test");
  expect(env.PICO_TEST_FAKE_MODEL).toBeUndefined();

  process.env.PICO_TEST_FAKE_MODEL = "https://api.anthropic.com";
  expect(() => claudeEnv("/pico/claude")).toThrow("127.0.0.1");
  delete process.env.PICO_TEST_FAKE_MODEL;
  expect(() => claudeEnv("/pico/claude")).toThrow("fake model");
});

test("a Claude Code session never sees the researcher's paid routes", async () => {
  fake = startFakeModel();
  Object.assign(process.env, researcherRoutes);
  box = sandbox({ fakeModelUrl: fake.url });
  const { app } = box;
  const lab = await app.labs.create({
    name: "Environment",
    provider: "anthropic",
    model: "sonnet",
    thinking: "off",
  });
  fake.script.push(
    {
      toolCalls: [{ name: "Bash", arguments: { command: "env > env.txt" } }],
    },
    { text: "Saved the environment." },
  );
  await app.sessions.send(lab.id, "Save the environment");
  await until(async () => !(await app.sessions.state(lab.id)).streaming);
  const seen = readFileSync(join(lab.path, "env.txt"), "utf8");
  for (const value of Object.values(researcherRoutes))
    expect(seen).not.toContain(value);
  expect(seen).toContain(`CLAUDE_CONFIG_DIR=${app.paths.claudeConfigDir}`);
}, 30_000);

test("an account is accepted only when it is a Claude subscription login", () => {
  expect(
    subscriptionProblem({
      email: "researcher@example.com",
      subscriptionType: "Claude Pro",
      apiProvider: "firstParty",
    }),
  ).toBeNull();
  expect(
    subscriptionProblem({
      apiKeySource: "ANTHROPIC_API_KEY",
      apiProvider: "firstParty",
    }),
  ).toContain("API key");
  expect(
    subscriptionProblem({
      subscriptionType: "Claude Max",
      apiProvider: "bedrock",
    }),
  ).toContain("bedrock");
  expect(subscriptionProblem({})).toContain("not signed in");
});

/** Runs the real server entry point outside bun test, on an empty profile. */
async function start(extra: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "pico-start-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    PICO_DATA_DIR: join(root, "data"),
    PICO_LABS_DIR: join(root, "labs"),
    PICO_PORT: "0",
    // The probe stays local: no update checks or telemetry.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ...extra,
  };
  for (const name of [
    "NODE_ENV",
    "PICO_TEST_FAKE_MODEL",
    "PICO_CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ])
    if (!(name in extra)) delete env[name];
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "..", "src", "main.ts")],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => child.kill(), 60_000);
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
  return { code, stderr };
}

test("the server refuses to start without a Claude subscription login, even with an API key", async () => {
  const signedOut = await start({});
  expect(signedOut.code).toBe(1);
  expect(signedOut.stderr).toContain("Pico will not start");
  expect(signedOut.stderr).toContain("bun run login");

  const withKey = await start({ ANTHROPIC_API_KEY: "sk-ant-researcher-key" });
  expect(withKey.code).toBe(1);
  expect(withKey.stderr).toContain("bun run login");
  expect(withKey.stderr).not.toContain("sk-ant-researcher-key");

  const harness = await start({ PICO_TEST_FAKE_MODEL: "http://127.0.0.1:9" });
  expect(harness.code).toBe(1);
  expect(harness.stderr).toContain("only accepted by bun test");
}, 90_000);
