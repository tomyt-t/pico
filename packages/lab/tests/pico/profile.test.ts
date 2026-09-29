import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePiProfile } from "@/lab/models/pi-profile";
import { picoPaths } from "@/lab/runtime/paths";
import { createWebAccess } from "@/lab/sources/web-client";
import { defaultWebConfig } from "@/lab/sources/web-config";
import { createRuntime } from "../support/runtime";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test("two Pico installations have independent profiles and ignore the personal Pi environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-profile-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const personal = join(root, "personal");
  await mkdir(personal);
  const personalAuth = JSON.stringify({
    zai: { type: "api_key", key: "personal-secret-fixture" },
  });
  await writeFile(join(personal, "auth.json"), personalAuth);
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = personal;
  cleanups.push(async () => {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  });
  const a = await createRuntime({ dataDir: join(root, "a") });
  cleanups.push(() => a.close());
  const b = await createRuntime({ dataDir: join(root, "b") });
  cleanups.push(() => b.close());
  const ca = await a.models.catalog();
  const cb = await b.models.catalog();
  expect(ca.agentDir).toBe(join(root, "a/pi"));
  expect(cb.agentDir).toBe(join(root, "b/pi"));
  expect(await readFile(join(personal, "auth.json"), "utf8")).toBe(
    personalAuth,
  );
  expect(
    JSON.parse(await readFile(join(ca.agentDir, "auth.json"), "utf8")),
  ).toEqual({});
  expect(
    JSON.parse(await readFile(join(cb.agentDir, "auth.json"), "utf8")),
  ).toEqual({});
  expect(JSON.stringify([ca, cb])).not.toContain("personal-secret-fixture");
});

test("the project-bundled Pi command uses the explicit Pico profile and never the global binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-cli-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const child = Bun.spawn([process.execPath, "scripts/pi.ts", "--version"], {
    cwd: join(import.meta.dir, "../../../.."),
    env: {
      ...process.env,
      PICO_DATA_DIR: root,
      PICO_PI_AGENT_DIR: join(root, "own-profile"),
      PI_CODING_AGENT_DIR: join(root, "personal"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain(join(root, "own-profile"));
  expect(stdout).toContain("0.86.1");
  expect(stdout).not.toContain(join(root, "personal"));
});

test("invalid search configuration fails without leaking secrets, and fixing it permits a new host", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-web-recovery-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const paths = picoPaths(root, join(root, "pi"));
  preparePiProfile(paths.agentDir, defaultWebConfig);
  await writeFile(
    join(paths.agentDir, "web-search.json"),
    "broken-private-config-secret",
  );
  const web = createWebAccess(paths);
  cleanups.push(() => web.close());
  let failure = "";
  try {
    await web.execute("lab", "get_search_content", { responseId: "missing" });
  } catch (error) {
    failure = String(error);
  }
  expect(failure).toContain("initialize");
  expect(failure).not.toContain("private-config-secret");
  await writeFile(join(paths.agentDir, "web-search.json"), "{}");
  await Bun.sleep(30);
  await expect(
    web.execute("lab", "get_search_content", { responseId: "missing" }),
  ).rejects.toThrow("Web tool failed");
});
