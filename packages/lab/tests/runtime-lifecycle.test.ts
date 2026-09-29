import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLabRuntime } from "@pico/lab";

test("construction is inert; captured capabilities reject outside active lifecycle and close stays idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-lifecycle-"));
  const runtime = createLabRuntime({ dataDir: join(root, "data") });
  const list = runtime.research.listLabs;
  try {
    expect(existsSync(join(root, "data"))).toBe(false);
    expect(() => list()).toThrow("not accepting");
    expect(runtime.start()).toBe(runtime.start());
    await runtime.start();
    expect(list()).toEqual([]);
    const closing = runtime.close();
    expect(runtime.close()).toBe(closing);
    await closing;
    expect(runtime.state).toBe("closed");
    await runtime.close();
    expect(runtime.state).toBe("closed");
    expect(() => list()).toThrow("not accepting");
    await expect(runtime.start()).rejects.toThrow("closed");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an escaped asynchronous callback cannot use its finished admission scope during shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-scope-"));
  const runtime = createLabRuntime({ dataDir: root });
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let escaped: Promise<unknown> | undefined;
  try {
    await runtime.start();
    await runtime.withOperation(async () => {
      escaped = release.promise.then(() => {
        started.resolve();
        return runtime.research.listLabs();
      });
      void escaped.catch(() => undefined);
    });
    await runtime.close();
    release.resolve();
    await started.promise;
    await expect(escaped).rejects.toThrow("not accepting");
  } finally {
    release.resolve();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("closing from an admitted scope is rejected instead of waiting for its own operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-scope-close-"));
  const runtime = createLabRuntime({ dataDir: root });
  try {
    await runtime.start();
    await runtime.withOperation(async () => {
      await expect(runtime.close()).rejects.toThrow(
        "outside an admitted operation",
      );
      expect(runtime.state).toBe("active");
      expect(runtime.research.listLabs()).toEqual([]);
    });
    await runtime.close();
    expect(() => runtime.research.listLabs()).toThrow("not accepting");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("closing during startup releases both locks without admitting any capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "pico-start-close-"));
  const runtime = createLabRuntime({ dataDir: root });
  try {
    const starting = runtime.start();
    await runtime.close();
    await starting;
    expect(runtime.state).toBe("closed");
    const reopened = createLabRuntime({ dataDir: root });
    await reopened.start();
    await reopened.close();
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
