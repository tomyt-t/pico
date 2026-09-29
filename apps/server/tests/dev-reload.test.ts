import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("development watcher survives repeated edits during application bootstrap", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-dev-reload-"));
  const source = await readFile(
    resolve(import.meta.dir, "../src/main.ts"),
    "utf8",
  );
  await writeFile(
    join(root, "main.ts"),
    `import { revision } from "./watched.ts";\nconsole.info("watch revision", revision);\n${source}`,
  );
  await writeFile(join(root, "watched.ts"), "export const revision = 0;\n");
  // Exercise the actual application lifecycle without binding a test TCP port.
  // The reload regression occurs before HTTP startup, while Pi's SDK imports.
  await writeFile(
    join(root, "preload.ts"),
    `
    Bun.serve = () => ({ url: new URL("http://127.0.0.1:0"), stop: async () => {} });
    setInterval(() => {}, 1000);
  `,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "--watch",
      "--no-clear-screen",
      "--preload",
      join(root, "preload.ts"),
      "--tsconfig-override",
      resolve(import.meta.dir, "../tsconfig.json"),
      join(root, "main.ts"),
    ],
    {
      env: {
        ...process.env,
        PICO_DATA_DIR: join(root, "data"),
        PICO_PI_AGENT_DIR: join(root, "agent"),
        PICO_PORT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let stdout = "";
  let stderr = "";
  let exited = false;
  const drained = Promise.all([
    (async () => {
      for await (const chunk of child.stdout)
        stdout += Buffer.from(chunk).toString();
    })(),
    (async () => {
      for await (const chunk of child.stderr)
        stderr += Buffer.from(chunk).toString();
    })(),
  ]);
  void child.exited.then(() => {
    exited = true;
  });
  async function until(check: () => boolean) {
    const deadline = Date.now() + 8000;
    while (!check()) {
      if (exited)
        throw new Error(
          `Watcher exited before readiness: ${stdout}\n${stderr}`,
        );
      if (Date.now() >= deadline)
        throw new Error(`Watcher readiness timed out: ${stdout}\n${stderr}`);
      await Bun.sleep(15);
    }
  }
  try {
    await until(() => stdout.includes("Pico ready"));
    for (let revision = 1; revision <= 12; revision++) {
      await writeFile(
        join(root, "watched.ts"),
        `export const revision = ${revision};\n`,
      );
      await Bun.sleep(55);
    }
    await until(() => /watch revision 12[\s\S]*Pico ready/.test(stdout));
    expect(exited).toBe(false);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
  } finally {
    if (!exited) child.kill("SIGKILL");
    await child.exited;
    await drained;
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

test("HTTP entrypoint aborts application work before waiting for active requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-entrypoint-stop-"));
  const source = await readFile(
    resolve(import.meta.dir, "../src/main.ts"),
    "utf8",
  );
  await writeFile(join(root, "main.ts"), source);
  await writeFile(
    join(root, "preload.ts"),
    `
    const gate = Promise.withResolvers();
    globalThis.finishHttp = gate.resolve;
    Bun.serve = () => ({ url: new URL("http://127.0.0.1:0"), stop: () => {
      console.info("http stop requested");
      return gate.promise;
    } });
    setInterval(() => {}, 1000);
  `,
  );
  await writeFile(
    join(root, "application.ts"),
    `
    export async function createServerApplication() {
      return {
        fetch: async () => new Response("unused"),
        close: async () => {
          console.info("application abort requested");
          globalThis.finishHttp();
        }
      };
    }
  `,
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: { "@/server/server": [join(root, "application.ts")] },
      },
    }),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(root, "preload.ts"),
      "--tsconfig-override",
      join(root, "tsconfig.json"),
      join(root, "main.ts"),
    ],
    {
      env: {
        ...process.env,
        PICO_DATA_DIR: join(root, "data"),
        PICO_PORT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let stdout = "";
  let stderr = "";
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drained = Promise.all([
    (async () => {
      for await (const chunk of child.stdout)
        stdout += Buffer.from(chunk).toString();
    })(),
    (async () => {
      for await (const chunk of child.stderr)
        stderr += Buffer.from(chunk).toString();
    })(),
  ]);
  void child.exited.then(() => {
    exited = true;
  });
  try {
    const deadline = Date.now() + 5000;
    while (!stdout.includes("Pico ready")) {
      if (exited || Date.now() >= deadline)
        throw new Error(`Entrypoint did not start: ${stdout}\n${stderr}`);
      await Bun.sleep(15);
    }
    child.kill("SIGTERM");
    const code = await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("HTTP drain blocked the application's abort")),
          1500,
        );
      }),
    ]);
    await drained;
    expect(code).toBe(0);
    expect(stdout).toContain("http stop requested");
    expect(stdout).toContain("application abort requested");
  } finally {
    if (timer) clearTimeout(timer);
    if (!exited) child.kill("SIGKILL");
    await child.exited;
    await drained;
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
