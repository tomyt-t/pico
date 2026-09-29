import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunner,
  fileAccess,
  type Runner,
  type RunnerOptions,
  type RunRequest,
  type SnapshotSources,
} from "@pico/runner";

export const resources: { root: string; runner: Runner }[] = [];
export async function fixture(options: Partial<RunnerOptions> = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "pico-operational-")),
  );
  const workspaceDir = join(root, "inputs", "code");
  await mkdir(workspaceDir, { recursive: true });
  const runner = createRunner({ dataDir: root, pollMs: 30, ...options });
  resources.push({ root, runner });
  await runner.start();
  const sources: SnapshotSources = { workspaceDir, datasets: [] };
  const request = (
    runId = "run-1",
    patch: Partial<RunRequest> = {},
  ): RunRequest => ({
    runId,
    labId: "lab-1",
    experimentId: "experiment-1",
    protocol: "Measure preserved inputs",
    experimentRevision: 1,
    criteria: [],
    config: { seed: 17 },
    datasetIds: [],
    entrypoint: "main.py",
    args: [],
    timeoutMs: 3000,
    runtime: "python",
    ...patch,
  });
  return {
    root,
    runner,
    sources,
    request,
    write: (content: string, path = "main.py") =>
      fileAccess.writeBytes(workspaceDir, path, content),
  };
}
export async function cleanup() {
  const owned = resources.splice(0);
  for (const item of owned) {
    if (item.runner.lifecycle === "active") {
      for (const run of await item.runner.allRuns())
        if (["queued", "running"].includes(run.status)) {
          await item.runner.cancel(run.labId, run.id);
          try {
            await item.runner.waitForRun(run.labId, run.id, 2500);
          } catch {
            /* Deliberately ambiguous test fixtures have no process to cancel. */
          }
        }
    }
    await item.runner.close();
  }
  for (const root of new Set(owned.map((item) => item.root)))
    await rm(root, { recursive: true, force: true });
}
export async function eventually<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  timeout = 6000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Condition was not observed before its deadline");
}
export const metricProgram =
  'import json, os\nfrom pathlib import Path\nprint("measured")\nPath(os.environ["PICO_OUTPUT_DIR"], "metrics.json").write_text(json.dumps([{"name":"mean","value":3.0}]))\n';
