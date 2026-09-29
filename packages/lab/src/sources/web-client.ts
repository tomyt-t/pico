import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  type WebAccess,
  type WebToolName,
  webSchemas,
} from "@/lab/sources/web-protocol";

const responseSchema = z.object({
  ready: z.boolean().optional(),
  id: z.string().optional(),
  error: z.string().optional(),
  result: z.json().optional(),
});

export function createWebAccess(options: {
  agentDir: string;
  runtimeDir: string;
}): WebAccess {
  const workers = new Map<string, Promise<Worker>>();
  let closed = false;
  interface Worker {
    child: ChildProcess;
    ready: Promise<void>;
    exited: Promise<void>;
    calls: Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >;
  }
  async function start(labId: string): Promise<Worker> {
    if (!/^[a-zA-Z0-9_-]+$/.test(labId))
      throw new Error("Invalid laboratory ID");
    const root = join(options.runtimeDir, "web", labId);
    const agentDir = join(root, "agent");
    const cwd = join(root, "workspace");
    const temp = join(root, "tmp");
    await Promise.all(
      [agentDir, cwd, temp].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    );
    if (closed) throw new Error("Web access is closed");
    // Explicit environment: do not inherit personal Pi settings, browser flags, or LLM credentials.
    const env: NodeJS.ProcessEnv = {};
    for (const name of [
      "PATH",
      "HOME",
      "LANG",
      "LC_ALL",
      "SYSTEMROOT",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "EXA_API_KEY",
      "BRAVE_API_KEY",
      "SERPAPI_KEY",
      "SERPER_API_KEY",
    ]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    Object.assign(env, {
      PI_CODING_AGENT_DIR: agentDir,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
    });
    const child = fork(
      join(import.meta.dir, "web-worker.ts"),
      [agentDir, join(options.agentDir, "web-search.json")],
      {
        execPath: process.execPath,
        execArgv: [],
        cwd,
        env,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let resolveReady: () => void;
    let rejectReady: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A caller may be cancelled before it starts awaiting readiness.
    void ready.catch(() => {});
    const calls: Worker["calls"] = new Map();
    const fail = (error: Error) => {
      rejectReady(error);
      for (const call of calls.values()) call.reject(error);
      calls.clear();
    };
    const exited = new Promise<void>((resolve) =>
      child.once("close", () => {
        fail(new Error("Pico web process stopped; retry the tool."));
        if (workers.get(labId) === starting) workers.delete(labId);
        resolve();
      }),
    );
    child.once("error", () =>
      fail(new Error("Could not start Pico web tools")),
    );
    child.on("message", (raw) => {
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.ready) resolveReady();
      else if (message.id) {
        const call = calls.get(message.id);
        calls.delete(message.id);
        if (message.error) call?.reject(new Error(message.error));
        else call?.resolve(message.result);
      } else if (message.error) fail(new Error(message.error));
    });
    const starting = workers.get(labId);
    return { child, ready, exited, calls };
  }
  return {
    async execute(labId, name: WebToolName, input, signal) {
      if (closed) throw new Error("Web access is closed");
      const args = webSchemas[name].parse(input);
      signal?.throwIfAborted();
      let starting = workers.get(labId);
      if (!starting) {
        starting = start(labId);
        workers.set(labId, starting);
        const pending = starting;
        void pending.catch(() => {
          if (workers.get(labId) === pending) workers.delete(labId);
        });
      }
      const worker = await starting;
      const deadline = AbortSignal.any([
        AbortSignal.timeout(90000),
        ...(signal ? [signal] : []),
      ]);
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const cancel = () => {
          if (workers.get(labId) === starting) workers.delete(labId);
          worker.calls.delete(id);
          worker.child.kill("SIGKILL");
          reject(
            new Error(
              signal?.aborted
                ? "Web request cancelled"
                : "Web request timed out",
            ),
          );
        };
        deadline.addEventListener("abort", cancel, { once: true });
        if (deadline.aborted) {
          cancel();
          return;
        }
        const finish = (action: () => void) => {
          deadline.removeEventListener("abort", cancel);
          action();
        };
        worker.ready.then(
          () => {
            if (deadline.aborted) return;
            worker.calls.set(id, {
              resolve: (result) =>
                finish(() =>
                  resolve({
                    source: "pi-web-access",
                    retrievedAt: new Date().toISOString(),
                    result,
                  }),
                ),
              reject: (error) => finish(() => reject(error)),
            });
            worker.child.send({ id, name, input: args }, (error) => {
              if (error) {
                worker.calls.delete(id);
                finish(() =>
                  reject(new Error("Pico web process disconnected")),
                );
              }
            });
          },
          (error) => finish(() => reject(error)),
        );
      });
    },
    async close() {
      closed = true;
      const settled = await Promise.allSettled(workers.values());
      await Promise.all(
        settled.map(async (item) => {
          if (item.status !== "fulfilled") return;
          item.value.child.kill("SIGKILL");
          await item.value.exited;
        }),
      );
      workers.clear();
    },
  };
}
