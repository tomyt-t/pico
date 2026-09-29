import { z } from "zod";
import {
  type DatasetRegistration,
  type Experiment,
  experimentSchema,
  patchSchema,
  type Run,
} from "@/lab/contracts";
import type { ToolScope } from "@/lab/pico/tools/tool-definition";

const id = z.string().min(1);

export function registerExperimentTools({
  research,
  labId,
  tool,
}: ToolScope): void {
  tool(
    "create_experiment",
    "Plan an experiment linked to questions, with objective and protocol. Hypotheses are optional.",
    experimentSchema,
    (input, ctx) => research.createExperiment(labId, input, ctx),
  );
  tool(
    "revise_experiment",
    "Revise the working protocol; existing execution snapshots remain unchanged.",
    z
      .object({
        id,
        patch: patchSchema(experimentSchema),
        reason: z.string().min(1),
      })
      .strict(),
    (input, ctx) =>
      research.reviseExperiment(
        labId,
        input.id,
        input.patch,
        ctx,
        input.reason,
      ),
  );
  tool(
    "list_files",
    "List experiment workspace files.",
    z.object({ experimentId: id }).strict(),
    (input) => {
      research.getRecord<Experiment>(labId, "experiment", input.experimentId);
      return research.listFiles(labId, input.experimentId);
    },
  );
  tool(
    "read_file",
    "Read a file in the experiment workspace.",
    z.object({ experimentId: id, path: id }).strict(),
    (input) => {
      research.getRecord<Experiment>(labId, "experiment", input.experimentId);
      return research.readFile(labId, input.experimentId, input.path);
    },
  );
  tool(
    "write_file",
    "Write UTF-8 source code or configuration in an experiment workspace.",
    z
      .object({
        experimentId: id,
        path: id,
        content: z.string().max(1_000_000),
      })
      .strict(),
    (input, ctx) =>
      research.writeFile(
        labId,
        input.experimentId,
        { path: input.path, content: input.content },
        ctx,
      ),
  );
  tool(
    "lock_dependencies",
    "Resolve a written pyproject.toml with uv and preserve uv.lock. Set experiment runtime to uv before running.",
    z.object({ experimentId: id }).strict(),
    (input, ctx) => research.lockDependencies(labId, input.experimentId, ctx),
  );
  tool(
    "register_dataset",
    "Register immutable dataset bytes with provenance. Images use base64; text uses utf8.",
    z
      .object({
        name: id,
        version: id,
        description: z.string().optional(),
        source: id,
        license: z.string().optional(),
        splits: z.record(z.string(), z.number().int().nonnegative()).optional(),
        files: z
          .array(
            z
              .object({
                path: id,
                content: z.string(),
                encoding: z.enum(["utf8", "base64"]).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(1_000),
      })
      .strict(),
    (input, ctx) =>
      research.registerDataset(labId, input as DatasetRegistration, ctx),
  );
  tool(
    "start_run",
    "Queue one asynchronous local execution; completion returns to this conversation. Queue all conditions explicitly requested by the researcher in the same researcher turn; maxConcurrentRuns limits execution, not queue submission. Completion-event turns cannot start runs. referenceRunId reproduces preserved inputs/code/configuration.",
    z
      .object({
        experimentId: id,
        args: z.array(z.string()).optional(),
        config: z.record(z.string(), z.json()).optional(),
        timeoutSeconds: z.number().int().positive().optional(),
        referenceRunId: id.optional(),
      })
      .strict(),
    ({ experimentId, ...request }, ctx) =>
      research.startRun(labId, experimentId, request, ctx),
  );
  tool(
    "read_run",
    "Read run status, metrics, artifacts and reproduction snapshot. Do not repeatedly poll; completion is delivered automatically.",
    z.object({ runId: id }).strict(),
    (input) => research.getRecord<Run>(labId, "run", input.runId),
  );
  tool(
    "read_logs",
    "Inspect bounded stdout and stderr for a run.",
    z.object({ runId: id }).strict(),
    (input) => {
      research.getRecord<Run>(labId, "run", input.runId);
      return research.readLogs(labId, input.runId);
    },
  );
  tool(
    "read_artifact",
    "Read a UTF-8 output file, or get metadata for binary artifacts.",
    z.object({ runId: id, path: id }).strict(),
    async (input) => {
      const run = research.getRecord<Run>(labId, "run", input.runId);
      const metadata = run.artifacts.find((file) => file.path === input.path);
      const bytes = await research.readRunFile(
        labId,
        input.runId,
        "outputs",
        input.path,
      );
      if (/\.(png|jpg|jpeg|gif|webp|pdf|bin|pt)$/i.test(input.path))
        return {
          metadata,
          detail: "Binary artifact preserved; inspect via the experiment page.",
        };
      return {
        path: input.path,
        content: bytes.subarray(0, 64_000).toString("utf8"),
        clipped: bytes.length > 64_000,
      };
    },
  );
  tool(
    "cancel_run",
    "Cancel a queued or active execution.",
    z.object({ runId: id }).strict(),
    (input, ctx) => research.cancelRun(labId, input.runId, ctx),
  );
}
