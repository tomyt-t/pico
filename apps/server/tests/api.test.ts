import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ModelAdapter } from "@pico/lab";
import type { Lab } from "@pico/lab/contracts";
import { createServerApplication } from "@pico/server";
import { durableRecords } from "./durable-records";

type Application = Awaited<ReturnType<typeof createServerApplication>>;
const roots: string[] = [];
const applications: Application[] = [];
const directories = new WeakMap<Application, string>();
function dataDirectory(app: Application): string {
  const directory = directories.get(app);
  if (!directory) throw new Error("Test application directory is missing");
  return directory;
}
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "pico-api-"));
  roots.push(root);
  return root;
}
async function application(
  dataDir = join(temporary(), "data"),
  model?: ModelAdapter,
) {
  const app = await createServerApplication({ dataDir, model });
  directories.set(app, dataDir);
  applications.push(app);
  return app;
}
afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function request(
  path: string,
  body?: unknown,
  key: string = crypto.randomUUID(),
  method = "POST",
) {
  return new Request(
    `http://127.0.0.1:4317/api${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        },
  );
}
async function createLab(app: Application): Promise<Lab> {
  return (await app.fetch(request("/labs", { name: "API laboratory" }))).json();
}

test("runner path errors are visible 400/404 responses and malformed uploads do not become effects", async () => {
  const app = await application();
  const lab = await createLab(app);
  const ctx = {
    key: crypto.randomUUID(),
    actor: { kind: "researcher" as const },
  };
  const question = app.runtime.research.createQuestion(
    lab.id,
    { text: "Test?" },
    ctx,
  );
  const experiment = app.runtime.research.createExperiment(
    lab.id,
    {
      title: "Test",
      objective: "Test",
      protocol: "Test",
      questionIds: [question.id],
    },
    { ...ctx, key: crypto.randomUUID() },
  );
  const unsafe = await app.fetch(
    request(
      `/labs/${lab.id}/experiments/${experiment.id}/file`,
      { path: "../secret", content: "bad" },
      crypto.randomUUID(),
      "PUT",
    ),
  );
  expect(unsafe.status).toBe(400);
  expect((await unsafe.json()).error.code).toBe("BAD_REQUEST");
  const missing = await app.fetch(
    request(
      `/labs/${lab.id}/experiments/${experiment.id}/file?path=missing.py`,
    ),
  );
  expect(missing.status).toBe(404);
  const priorEffects = durableRecords(dataDirectory(app), "effect").length;
  const malformed = await app.fetch(
    request(`/labs/${lab.id}/datasets`, { name: "Missing files" }),
  );
  expect(malformed.status).toBe(400);
  expect(durableRecords(dataDirectory(app), "effect")).toHaveLength(
    priorEffects,
  );
});

test("API rejects rebinding hosts, foreign origins and unexpected suffixes", async () => {
  const app = await application();
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    Origin: "http://attacker.example:4317",
  };
  expect(
    (
      await app.fetch(
        new Request("http://attacker.example:4317/api/labs", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Attack" }),
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app.fetch(
        new Request("http://127.0.0.1:4317/api/labs", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Attack" }),
        }),
      )
    ).status,
  ).toBe(403);
  const lab = await createLab(app);
  expect(
    (
      await app.fetch(
        request(`/labs/${lab.id}/datasets/unexpected`, { name: "Ignored" }),
      )
    ).status,
  ).toBe(404);
  expect((await app.fetch(request("/health/unexpected"))).status).toBe(404);
  expect((await app.fetch(request("/labs/%broken"))).status).toBe(400);
});

test("invalid literature identifiers remain client errors without making an external request", async () => {
  const app = await application();
  const lab = await createLab(app);
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("An invalid DOI must be rejected before network access"),
  );
  try {
    const response = await app.fetch(
      request(`/labs/${lab.id}/papers/import`, {
        identifier: "definitely-not-a-doi",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test("backup HTTP retries return one completed destination", async () => {
  const root = temporary();
  const app = await application(join(root, "data"));
  const lab = await createLab(app);
  const key = crypto.randomUUID();
  const body = { destination: join(root, "backup") };
  const first = await app.fetch(request("/backup", body, key));
  const second = await app.fetch(request("/backup", body, key));
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual(await first.json());
  expect(app.runtime.research.getLab(lab.id).id).toBe(lab.id);
  expect(
    (
      await app.fetch(
        request("/backup", { destination: join(root, "other") }, key),
      )
    ).status,
  ).toBe(409);
});

test("provider connection tests do not follow credential-bearing redirects", async () => {
  const app = await application();
  const lab = await createLab(app);
  const name = "PICO_API_REDIRECT_TEST_KEY";
  const previous = process.env[name];
  process.env[name] = "fixture-secret";
  app.runtime.research.updateLab(
    lab.id,
    {
      settings: {
        provider: {
          mode: "openai-compatible",
          model: "test",
          baseUrl: "https://provider.example/v1",
          apiKeyEnv: name,
        },
      },
    },
    { key: crypto.randomUUID(), actor: { kind: "researcher" } },
  );
  const mocked = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", {
      status: 302,
      headers: { Location: "https://unexpected.example" },
    }),
  );
  try {
    const response = await app.fetch(
      request(`/labs/${lab.id}/provider/test`, {}),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).configured).toBe(false);
    expect(mocked.mock.calls[0]?.[1]?.redirect).toBe("error");
  } finally {
    mocked.mockRestore();
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

test("application ownership is released by the operating system after an abrupt process death", async () => {
  const dataDir = join(temporary(), "data");
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      'import { createLabRuntime } from "@pico/lab"; const runtime = createLabRuntime({dataDir:process.env.PICO_LOCK_TEST_PATH}); await runtime.start(); console.log("owned"); setInterval(() => {}, 1000);',
    ],
    {
      cwd: resolve(import.meta.dir, "../../.."),
      env: { ...process.env, PICO_LOCK_TEST_PATH: dataDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(ready.value)).toContain("owned");
    await expect(createServerApplication({ dataDir })).rejects.toThrow(
      "already using this data directory",
    );
    child.kill("SIGKILL");
    await child.exited;
    expect((await application(dataDir)).runtime.research.listLabs()).toEqual(
      [],
    );
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
});

test("stop retries do not stop a turn again after the researcher continues it", async () => {
  const first = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let calls = 0;
  const app = await application(undefined, async ({ signal }) => {
    if (++calls === 1) {
      first.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true },
        );
      });
    }
    resumed.resolve();
    await finish.promise;
    return { content: "Resumed work completed", calls: [] };
  });
  const lab = await createLab(app);
  const turn = app.runtime.conversation.enqueue(lab.id, "Research", {
    key: "start",
    actor: { kind: "researcher" },
  });
  try {
    await first.promise;
    const key = crypto.randomUUID();
    const path = `/labs/${lab.id}/turns/${turn.id}/stop`;
    expect((await app.fetch(request(path, {}, key))).status).toBe(200);
    expect(
      (
        await app.fetch(
          request(`/labs/${lab.id}/turns/${turn.id}/continue`, {}, "continue"),
        )
      ).status,
    ).toBe(200);
    await resumed.promise;
    const retry = await app.fetch(request(path, {}, key));
    expect((await retry.json()).status).toBe("cancelled");
    expect(app.runtime.conversation.getTurn(lab.id, turn.id).status).toBe(
      "running",
    );
    finish.resolve();
    for (
      let i = 0;
      i < 200 &&
      app.runtime.conversation.getTurn(lab.id, turn.id).status !== "completed";
      i++
    )
      await Bun.sleep(10);
    expect(app.runtime.conversation.getTurn(lab.id, turn.id).status).toBe(
      "completed",
    );
  } finally {
    finish.resolve();
  }
});

test("one data directory has one application owner and close drains accepted HTTP work", async () => {
  const root = temporary();
  const dataDir = join(root, "data");
  const app = await application(dataDir);
  await expect(createServerApplication({ dataDir })).rejects.toThrow(
    "already using this data directory",
  );
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const pending = app.fetch(
    new Request("http://127.0.0.1:4317/api/labs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: stream,
    }),
  );
  const closing = app.close();
  expect(app.close()).toBe(closing);
  expect((await app.fetch(request("/labs"))).status).toBe(503);
  if (!controller) throw new Error("Request stream was not initialized");
  controller.enqueue(
    new TextEncoder().encode(
      JSON.stringify({ name: "Accepted before shutdown" }),
    ),
  );
  controller.close();
  const response = await pending;
  expect(response.status).toBe(201);
  const lab = (await response.json()) as Lab;
  await closing;
  const reopened = await application(dataDir);
  expect(reopened.runtime.research.getLab(lab.id).name).toBe(
    "Accepted before shutdown",
  );
});

test.skipIf(!existsSync(resolve(import.meta.dir, "../../web/dist/index.html")))(
  "production entrypoint serves its own built UI and releases ownership on shutdown",
  async () => {
    const root = temporary();
    const dataDir = join(root, "data");
    const process = Bun.spawn(["bun", "apps/server/src/main.ts"], {
      cwd: resolve(import.meta.dir, "../../.."),
      env: {
        ...globalThis.process.env,
        PICO_DATA_DIR: dataDir,
        PICO_PORT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => process.kill("SIGKILL"), 10_000);
    try {
      const reader = process.stdout.getReader();
      let output = "";
      let url: string | undefined;
      while (!url) {
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error(
            `Server did not start: ${await new Response(process.stderr).text()}`,
          );
        output += new TextDecoder().decode(chunk.value);
        url = output.match(/Pico ready at (http:\/\/[^;]+);/)?.[1];
      }
      reader.releaseLock();
      const response = await fetch(url);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('<div id="root">');
      expect((await fetch(new URL("/api/health", url))).status).toBe(200);
      process.kill("SIGTERM");
      expect(await process.exited).toBe(0);
      const reopened = await application(dataDir);
      expect(reopened.runtime.research.listLabs()).toEqual([]);
    } finally {
      clearTimeout(timeout);
      if (process.exitCode === null) process.kill("SIGKILL");
      await process.exited;
    }
  },
  15_000,
);
