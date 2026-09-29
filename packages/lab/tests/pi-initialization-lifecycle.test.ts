import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLabRuntime } from "@pico/lab";
import { createPiAdapter } from "@/lab/models/pi-adapter";
import { createPiRuntime } from "@/lab/models/pi-runtime";

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

test("shutdown aborts Pi initialization while a session is waiting for it", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-pi-init-stop-"));
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<never>();
  void gate.promise.catch(() => undefined);
  let aborted = false;
  const pi = createPiRuntime({
    agentDir: join(root, "agent"),
    cwd: root,
    runtimeFactory: async (options) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          gate.reject(new DOMException("Stopped", "AbortError"));
        },
        { once: true },
      );
      entered.resolve();
      return gate.promise;
    },
  });
  const app = createLabRuntime({
    dataDir: join(root, "data"),
    models: {
      complete: createPiAdapter(pi),
      catalog: () => pi.catalog(),
      status: (config) => pi.status(config),
      close: () => pi.close(),
    },
  });
  await app.start();
  try {
    const lab = app.research.createLab({
      name: "Shutdown during Pi initialization",
      settings: {
        provider: {
          mode: "pi",
          provider: "synthetic",
          model: "synthetic",
          baseUrl: "https://unused.example/v1",
          apiKeyEnv: "UNUSED_TEST_KEY",
        },
      },
    });
    const turn = app.conversation.enqueue(lab.id, "Begin", {
      key: "shutdown-inference",
      actor: { kind: "researcher" },
    });
    await entered.promise;
    await promptly(app.close());
    expect(aborted).toBe(true);
    const reopened = createLabRuntime({
      dataDir: join(root, "data"),
      piAgentDir: join(root, "agent"),
    });
    await reopened.start();
    try {
      expect(reopened.conversation.getTurn(lab.id, turn.id).status).toBe(
        "interrupted",
      );
      const db = new Database(join(root, "data", "pico.sqlite"), {
        readonly: true,
      });
      try {
        expect(
          db
            .query(
              "SELECT id FROM records WHERE kind = 'model_step' AND lab_id = ?",
            )
            .all(lab.id),
        ).toHaveLength(0);
      } finally {
        db.close();
      }
    } finally {
      await reopened.close();
    }
  } finally {
    gate.reject(new DOMException("Cleanup", "AbortError"));
    await pi.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
