import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRunner as createOperationalRunner } from "@pico/runner";
import type {
  Actor,
  DatasetRegistration,
  FileContentInput,
  Run,
} from "@/lab/contracts";
import { ResearchExecution } from "@/lab/research/execution";
import { datasetVersion, manifestFile } from "@/lab/research/run-projection";
import { ResearchFiles } from "@/lab/storage/research-files";

class ScientificRunnerFixture extends ResearchExecution {
  async writeFile(labId: string, experimentId: string, file: FileContentInput) {
    return manifestFile(await this.files.writeFile(labId, experimentId, file));
  }
  readFile(labId: string, experimentId: string, path: string) {
    return this.files.readFile(labId, experimentId, path);
  }
  async listFiles(labId: string, experimentId: string) {
    return (await this.files.listFiles(labId, experimentId)).map(manifestFile);
  }
  async registerDataset(
    labId: string,
    id: string,
    input: DatasetRegistration,
    author: Actor = { kind: "researcher" },
  ) {
    return datasetVersion(
      await this.files.registerDataset({
        ...input,
        id,
        labId,
        author,
        license: input.license || "unknown",
      }),
    );
  }
  async getDataset(labId: string, id: string) {
    return datasetVersion(await this.files.getDataset(labId, id));
  }
  readDatasetFile(labId: string, id: string, path: string) {
    return this.files.readDatasetFile(labId, id, path);
  }
  async lockDependencies(labId: string, experimentId: string) {
    const cwd = await this.files.workspace(labId, experimentId);
    const result = await promisify(execFile)("uv", ["lock", "--project", cwd], {
      cwd,
      timeout: 60000,
    });
    return {
      files: await this.listFiles(labId, experimentId),
      log: result.stdout + result.stderr,
    };
  }
}
export type LocalRunner = ScientificRunnerFixture;
export async function createRunner(options: {
  dataDir: string;
  piAgentDir?: string;
  maxConcurrent?: number;
  getLabConcurrency?: (id: string) => number;
  pollMs?: number;
  onUpdate?: (run: Run) => void | Promise<void>;
}) {
  let projection: ScientificRunnerFixture | undefined;
  const profile =
    options.piAgentDir ?? join(await realpath(options.dataDir), "pi");
  const runner = await createOperationalRunner({
    ...options,
    environmentBindings: {
      PICO_PI_AGENT_DIR: profile,
      PI_CODING_AGENT_DIR: profile,
    },
    onUpdate: async (record) => {
      if (projection)
        await options.onUpdate?.(await projection.projectRun(record));
    },
  });
  projection = new ScientificRunnerFixture(
    new ResearchFiles(options.dataDir),
    runner,
  );
  await runner.start();
  await runner.resumeDispatch();
  return projection;
}
