import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecutionStatus, Lab, Message } from "@pico/lab/contracts";
import { createServerApplication } from "@pico/server";

type Application = Awaited<ReturnType<typeof createServerApplication>>;
const applications: Application[] = [];
const roots: string[] = [];
const context = () => ({
  key: crypto.randomUUID(),
  actor: { kind: "researcher" as const },
});
function directory() {
  const root = mkdtempSync(join(tmpdir(), "pico-http-stabilization-"));
  roots.push(root);
  return root;
}
async function fixture() {
  const root = directory();
  const app = await createServerApplication({
    dataDir: join(root, "data"),
    model: async () => ({
      content: "Simulated transport test response",
      calls: [],
    }),
  });
  applications.push(app);
  const first = app.runtime.research.createLab(
    { name: "First laboratory" },
    context(),
  );
  const second = app.runtime.research.createLab(
    { name: "Second laboratory" },
    context(),
  );
  return { app, root, first, second };
}
function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(
    `http://127.0.0.1:4317/api${path}`,
    body === undefined
      ? { headers }
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            ...headers,
          },
          body: JSON.stringify(body),
        },
  );
}
function expectPolicy(response: Response) {
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "img-src 'self' data: blob:",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'self'",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "object-src 'none'",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}
afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("conditional overview responses retain browser policy and invalidate only when their laboratory changes", async () => {
  const { app, first, second } = await fixture();
  const path = `/labs/${first.id}/overview`;
  const initial = await app.fetch(request(path));
  expect(initial.status).toBe(200);
  expectPolicy(initial);
  const tag = initial.headers.get("ETag");
  if (!tag) throw new Error("Expected a representation ETag");
  expect(initial.headers.get("Cache-Control")).toBe("private, no-cache");
  await initial.json();
  const unchanged = await app.fetch(
    request(path, undefined, { "If-None-Match": `"unrelated", ${tag}` }),
  );
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe("");
  expect(unchanged.headers.get("ETag")).toBe(tag);
  expectPolicy(unchanged);
  expect(
    (
      await app.fetch(
        request(`/labs/${second.id}/questions`, {
          text: "A separate laboratory's question",
        }),
      )
    ).status,
  ).toBe(201);
  expect(
    (await app.fetch(request(path, undefined, { "If-None-Match": tag })))
      .status,
  ).toBe(304);
  expect(
    (
      await app.fetch(
        request(`/labs/${first.id}/questions`, {
          text: "A new question changes this representation",
        }),
      )
    ).status,
  ).toBe(201);
  const changed = await app.fetch(
    request(path, undefined, { "If-None-Match": tag }),
  );
  expect(changed.status).toBe(200);
  expect(changed.headers.get("ETag")).not.toBe(tag);
  expect((await changed.json()).questions).toHaveLength(1);
  const missing = await app.fetch(request("/does-not-exist"));
  expect(missing.status).toBe(404);
  expect(missing.headers.get("ETag")).toBeNull();
  expectPolicy(missing);
});

async function messages(app: Application, lab: Lab, prefix: string) {
  const turns = Array.from({ length: 4 }, (_, index) =>
    app.runtime.conversation.enqueue(lab.id, `${prefix}-${index}`, context()),
  );
  const deadline = Date.now() + 3000;
  while (
    turns.some(
      (turn) =>
        app.runtime.conversation.getTurn(lab.id, turn.id).status !==
        "completed",
    )
  ) {
    if (Date.now() >= deadline)
      throw new Error("Simulated conversation did not finish");
    await Bun.sleep(5);
  }
  return app.runtime.research.readHistory(lab.id, { limit: 100 });
}
test("HTTP history pagination has no gaps or duplicates and foreign cursors never reveal another laboratory", async () => {
  const { app, first, second } = await fixture();
  const expected = await messages(app, first, "first-private-message");
  const foreign = await messages(app, second, "second-private-message");
  const collected: Message[] = [];
  let before: string | undefined;
  for (;;) {
    const response = await app.fetch(
      request(
        `/labs/${first.id}/history?limit=3${before ? `&before=${encodeURIComponent(before)}` : ""}`,
      ),
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as Message[];
    expect(page.length).toBeLessThanOrEqual(3);
    expect(page.every((message) => message.labId === first.id)).toBe(true);
    if (!page.length) break;
    collected.unshift(...page);
    before = page[0]?.id;
  }
  expect(collected.map((message) => message.id)).toEqual(
    expected.map((message) => message.id),
  );
  expect(new Set(collected.map((message) => message.id)).size).toBe(
    collected.length,
  );
  const otherCursor = foreign.at(-1)?.id;
  if (!otherCursor) throw new Error("Foreign conversation has no cursor");
  const escaped = await app.fetch(
    request(
      `/labs/${first.id}/history?before=${encodeURIComponent(otherCursor)}&limit=200`,
    ),
  );
  expect(await escaped.json()).toEqual([]);
  expect(
    (await app.fetch(request(`/labs/${second.id}/history?limit=200`))).status,
  ).toBe(200);
  for (const limit of ["0", "201", "1.5", "invalid"])
    expect(
      (await app.fetch(request(`/labs/${first.id}/history?limit=${limit}`)))
        .status,
    ).toBe(400);
});

test("execution status names the other laboratory blocking global admission without exposing its damaged record", async () => {
  const { app, root, first, second } = await fixture();
  const broken = join(
    root,
    "data",
    "labs",
    second.id,
    "runs",
    "unreadable-run",
  );
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, "run.json"), '{"private-study":"damaged');
  const response = await app.fetch(request(`/labs/${first.id}/execution`));
  expect(response.status).toBe(200);
  const status = (await response.json()) as ExecutionStatus;
  expect(status.blocked).toBe(true);
  expect(status.otherBlockedLabs).toEqual([
    { labId: second.id, name: second.name },
  ]);
  expect(status.issues).toEqual([]);
  expect(status.runs).toEqual([]);
  expect(JSON.stringify(status)).not.toContain("private-study");
  const source = (await (
    await app.fetch(request(`/labs/${second.id}/execution`))
  ).json()) as ExecutionStatus;
  expect(source.issues).toMatchObject([
    { runId: "unreadable-run", labId: second.id, kind: "unreadable_record" },
  ]);
  expect(source.otherBlockedLabs).toEqual([]);
  const foreignRepair = await app.fetch(
    request(`/labs/${first.id}/execution/unreadable-run/repair`, {}),
  );
  expect(foreignRepair.status).toBe(404);
  rmSync(broken, { recursive: true });
  expect(
    (
      (await (
        await app.fetch(request(`/labs/${first.id}/execution`))
      ).json()) as ExecutionStatus
    ).blocked,
  ).toBe(false);
});

test.skipIf(!existsSync(resolve(import.meta.dir, "../../web/dist/index.html")))(
  "production UI document and API apply the same restrictive browser policy",
  async () => {
    const root = directory();
    const child = Bun.spawn(["bun", "apps/server/src/main.ts"], {
      cwd: resolve(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        PICO_DATA_DIR: join(root, "data"),
        PICO_PORT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      const reader = child.stdout.getReader();
      let output = "";
      let url: string | undefined;
      while (!url) {
        const next = await reader.read();
        if (next.done)
          throw new Error(
            `Production server failed to start: ${await new Response(child.stderr).text()}`,
          );
        output += new TextDecoder().decode(next.value);
        url = output.match(/Pico ready at (http:\/\/[^;]+);/)?.[1];
      }
      reader.releaseLock();
      const document = await fetch(url);
      expect(document.status).toBe(200);
      expect(document.headers.get("Content-Type")).toContain("text/html");
      expectPolicy(document);
      expect(await document.text()).toContain('<div id="root">');
      expectPolicy(await fetch(new URL("/api/health", url)));
    } finally {
      clearTimeout(deadline);
      child.kill("SIGTERM");
      await child.exited;
    }
  },
  15000,
);
