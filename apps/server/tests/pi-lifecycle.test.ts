import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelAccess } from "@pico/lab";
import type { PiCatalog } from "@pico/lab/contracts";
import { createServerApplication } from "@pico/server";

async function promptly<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Shutdown did not settle after abort")),
          1500,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("shutdown aborts pending Pi metadata before draining HTTP and releases the data lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-pi-shutdown-"));
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<PiCatalog>();
  const empty: PiCatalog = {
    providers: [],
    defaultSelection: null,
    agentDir: root,
  };
  let piClosed = false;
  const models: ModelAccess = {
    complete: async () => {
      throw new Error("Unused");
    },
    catalog: () => {
      entered.resolve();
      return gate.promise;
    },
    status: async (config) => ({
      mode: config.mode,
      model: config.model,
      configured: false,
      detail: "Synthetic test",
    }),
    close: async () => {
      piClosed = true;
      gate.resolve(empty);
    },
  };
  const app = await createServerApplication({ dataDir: root, models });
  try {
    const response = app.fetch(new Request("http://localhost/api/providers"));
    await entered.promise;
    const closing = app.close();
    expect(
      (await app.fetch(new Request("http://localhost/api/labs"))).status,
    ).toBe(503);
    await promptly(closing);
    expect(piClosed).toBe(true);
    expect((await response).status).toBe(200);
    const reopened = await createServerApplication({ dataDir: root, models });
    await reopened.close();
  } finally {
    gate.resolve(empty);
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
