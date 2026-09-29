import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileContentInput, MutationContext } from "@/lab/contracts";
import type { EffectCoordinator } from "@/lab/research/effects";
import { LabError } from "@/lab/research/errors";
import type { Laboratory } from "@/lab/research/laboratory";
import { manifestFile } from "@/lab/research/run-projection";
import type { ResearchFiles } from "@/lab/storage/research-files";
export function createWorkspace(
  lab: Laboratory,
  files: ResearchFiles,
  effects: EffectCoordinator,
) {
  function check(labId: string, experimentId: string) {
    lab.getRecord(labId, "experiment", experimentId);
  }
  return {
    async listFiles(labId: string, experimentId: string) {
      check(labId, experimentId);
      return (await files.listFiles(labId, experimentId)).map(manifestFile);
    },
    async readFile(labId: string, experimentId: string, path: string) {
      check(labId, experimentId);
      return files.readFile(labId, experimentId, path);
    },
    async writeFile(
      labId: string,
      experimentId: string,
      file: FileContentInput,
      ctx: MutationContext,
    ) {
      check(labId, experimentId);
      return effects.run(
        labId,
        "writeFile",
        { experimentId, ...file },
        ctx,
        async () =>
          manifestFile(await files.writeFile(labId, experimentId, file)),
      );
    },
    async lockDependencies(
      labId: string,
      experimentId: string,
      ctx: MutationContext,
    ) {
      check(labId, experimentId);
      return effects.run(
        labId,
        "lockDependencies",
        { experimentId },
        ctx,
        async () => {
          const manifests = await files.listFiles(labId, experimentId);
          if (!manifests.some((file) => file.path === "pyproject.toml"))
            throw new LabError(
              "BAD_REQUEST",
              "Write pyproject.toml before resolving dependencies",
            );
          const cwd = await files.workspace(labId, experimentId);
          const env = Object.fromEntries(
            ["PATH", "HOME", "TMPDIR", "LANG"].flatMap((name) =>
              process.env[name] ? [[name, process.env[name] ?? ""]] : [],
            ),
          );
          const result = await promisify(execFile)(
            "uv",
            ["lock", "--project", cwd],
            { cwd, env, timeout: 60000, maxBuffer: 1024 * 1024 },
          );
          return {
            files: (await files.listFiles(labId, experimentId)).map(
              manifestFile,
            ),
            log: `${result.stdout}${result.stderr}`,
          };
        },
      );
    },
  };
}
