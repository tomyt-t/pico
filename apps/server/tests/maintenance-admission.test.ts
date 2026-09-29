import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LabRuntimeOptions } from "@pico/lab";
import { createServerApplication } from "@/server/server";

const models: NonNullable<LabRuntimeOptions["models"]> = {
  complete: async () => ({ content: "Simulated", calls: [] }),
  catalog: async () => ({
    providers: [],
    defaultSelection: null,
    agentDir: "fixture",
  }),
  status: async (config) => ({
    mode: config.mode,
    model: config.model,
    configured: true,
    detail: "Simulated",
  }),
  close: async () => {},
};
const sources: NonNullable<LabRuntimeOptions["sources"]> = {
  execute: async () => {
    throw new Error("No external access in this test");
  },
  search: async () => {
    throw new Error("No external access in this test");
  },
  import: async () => {
    throw new Error("No external access in this test");
  },
  close: async () => {},
};

test("maintenance rejects a captured HTTP handler with 503 while an admitted body drains", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-http-maintenance-"));
  const app = await createServerApplication({
    dataDir: join(root, "data"),
    models,
    sources,
  });
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller;
    },
  });
  const capturedFetch = app.fetch;
  const admitted = app.fetch(
    new Request("http://127.0.0.1/api/labs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "already-admitted",
      },
      body: stream,
    }),
  );
  const backup = app.runtime.administration.backup(join(root, "backup"), {
    key: "maintenance",
    actor: { kind: "researcher" },
  });
  try {
    const blocked = capturedFetch(new Request("http://127.0.0.1/api/health"));
    expect(blocked).toBeInstanceOf(Promise);
    expect((await blocked).status).toBe(503);
    expect(
      await (
        await capturedFetch(new Request("http://127.0.0.1/api/health"))
      ).json(),
    ).toMatchObject({ error: { code: "UNAVAILABLE" } });
    body?.enqueue(
      new TextEncoder().encode(
        JSON.stringify({ name: "Request admitted before maintenance" }),
      ),
    );
    body?.close();
    body = undefined;
    expect((await admitted).status).toBe(201);
    expect((await backup).path).toBe(join(root, "backup"));
    expect(
      (await capturedFetch(new Request("http://127.0.0.1/api/health"))).status,
    ).toBe(200);
  } finally {
    body?.error(new Error("Test cleanup"));
    await Promise.allSettled([admitted, backup]);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("close from an admitted operation rejects without deadlocking a concurrent backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-maintenance-close-"));
  const app = await createServerApplication({
    dataDir: join(root, "data"),
    models,
    sources,
  });
  const release = Promise.withResolvers<void>();
  const admitted = app.runtime.withOperation(async () => {
    await release.promise;
    await app.runtime.close();
  });
  void admitted.catch(() => undefined);
  const backup = app.runtime.withOperation(() =>
    app.runtime.administration.backup(join(root, "backup"), {
      key: "maintenance-close",
      actor: { kind: "researcher" },
    }),
  );
  release.resolve();
  try {
    await expect(admitted).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await backup).path).toBe(join(root, "backup"));
    expect(app.runtime.state).toBe("active");
    await app.close();
    expect(app.runtime.state).toBe("closed");
  } finally {
    release.resolve();
    await Promise.allSettled([admitted, backup]);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
