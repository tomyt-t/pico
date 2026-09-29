import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  DatasetManifest,
  RunRecord,
  RunRequest,
  SnapshotManifest,
  SnapshotSources,
} from "@/runner/execution-contract";
import type { ExecutionFiles } from "@/runner/execution-files";
import {
  atomicJson,
  copyVerified,
  digest,
  ensureDirectory,
  exists,
  type FileDigest,
  RunnerError,
  readBytes,
  readJson,
  safeId,
  writeBytes,
} from "@/runner/files";
import { validateRequest, verifySnapshot } from "@/runner/format-v1";

export class Snapshots {
  constructor(private readonly files: ExecutionFiles) {}
  async get(labId: string, runId: string): Promise<SnapshotManifest> {
    return verifySnapshot(
      await readJson<SnapshotManifest>(
        join(this.files.runDir(labId, runId), "snapshot"),
        "manifest.json",
      ),
    );
  }
  async readFile(
    labId: string,
    runId: string,
    area: "code" | "outputs",
    path: string,
  ): Promise<Buffer> {
    const manifest =
      area === "code"
        ? (await this.get(labId, runId)).code
        : (await this.files.getRun(labId, runId)).artifacts;
    const file = manifest.find((item) => item.path === path);
    if (!file)
      throw new RunnerError("File is not part of the run manifest", "missing");
    const bytes = await readBytes(
      join(
        this.files.runDir(labId, runId),
        area === "code" ? "snapshot/code" : "outputs",
      ),
      path,
    );
    if (digest(bytes) !== file.sha256 || bytes.length !== file.bytes)
      throw new RunnerError(
        "Preserved file integrity check failed",
        "conflict",
      );
    return bytes;
  }
  async publish(
    request: RunRequest,
    sources?: SnapshotSources,
  ): Promise<RunRecord> {
    validateRequest(request);
    const target = this.files.runDir(request.labId, request.runId);
    if (await exists(target)) {
      const previous = await this.get(request.labId, request.runId);
      if (JSON.stringify(previous.request) !== JSON.stringify(request))
        throw new RunnerError(
          "Run identifier already belongs to another request",
          "conflict",
        );
      return this.files.getRun(request.labId, request.runId);
    }
    await ensureDirectory(
      this.files.root,
      `labs/${safeId(request.labId)}/runs`,
    );
    const staging = `${target}.pending-${randomUUID()}`;
    await mkdir(join(staging, "snapshot", "code"), { recursive: true });
    try {
      let code: FileDigest[];
      let datasets: DatasetManifest[];
      if (request.referenceRunId) {
        const reference = await this.get(request.labId, request.referenceRunId);
        if (reference.request.experimentId !== request.experimentId)
          throw new RunnerError(
            "Reference run must belong to the same experiment",
          );
        const expected = {
          ...reference.request,
          runId: request.runId,
          referenceRunId: request.referenceRunId,
        };
        if (JSON.stringify(expected) !== JSON.stringify(request))
          throw new RunnerError(
            "Reproduction must preserve the reference request",
          );
        code = await copyVerified(
          join(
            this.files.runDir(request.labId, request.referenceRunId),
            "snapshot",
            "code",
          ),
          join(staging, "snapshot", "code"),
          reference.code,
        );
        datasets = reference.datasets;
        for (const dataset of datasets)
          await copyVerified(
            join(
              this.files.runDir(request.labId, request.referenceRunId),
              "snapshot",
              "inputs",
              dataset.id,
            ),
            join(staging, "snapshot", "inputs", dataset.id),
            dataset.files,
          );
      } else {
        if (!sources)
          throw new RunnerError(
            "Snapshot sources are required for a new execution",
          );
        const wanted = request.datasetIds ?? [];
        if (
          sources.datasets.length !== wanted.length ||
          sources.datasets.some(({ manifest }) => !wanted.includes(manifest.id))
        )
          throw new RunnerError(
            "Dataset sources do not match the execution request",
          );
        code = await copyVerified(
          sources.workspaceDir,
          join(staging, "snapshot", "code"),
        );
        datasets = [];
        for (const datasetId of request.datasetIds ?? []) {
          const source = sources.datasets.find(
            ({ manifest }) => manifest.id === datasetId,
          );
          if (!source || source.manifest.labId !== request.labId)
            throw new RunnerError(
              "Dataset source belongs to another laboratory",
            );
          const dataset = source.manifest;
          await copyVerified(
            source.filesDir,
            join(staging, "snapshot", "inputs", datasetId),
            dataset.files,
          );
          datasets.push(dataset);
        }
      }
      if (!code.some((file) => file.path === request.entrypoint))
        throw new RunnerError(
          "Entrypoint is missing from the experiment workspace",
        );
      if (
        request.runtime === "uv" &&
        (!code.some((file) => file.path === "uv.lock") ||
          !code.some((file) => file.path === "pyproject.toml"))
      )
        throw new RunnerError(
          "uv execution requires both pyproject.toml and uv.lock before submitting",
        );
      const createdAt = new Date().toISOString();
      const runtime = request.runtime ?? "python";
      const version = await promisify(execFile)(
        runtime === "uv" ? "uv" : "python3",
        ["--version"],
        {
          timeout: 5000,
          maxBuffer: 4096,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        },
      );
      const content = {
        request,
        code,
        datasets,
        environment: {
          platform: process.platform,
          arch: process.arch,
          runtime,
          runtimeVersion: `${version.stdout}${version.stderr}`.trim(),
        },
      };
      const snapshot: SnapshotManifest = {
        schemaVersion: 1,
        createdAt,
        ...content,
        sha256: digest(JSON.stringify(content)),
      };
      await atomicJson(join(staging, "snapshot", "manifest.json"), snapshot);
      await atomicJson(
        join(staging, "snapshot", "config.json"),
        request.config,
      );
      await writeBytes(
        join(staging, "snapshot"),
        "protocol.md",
        request.protocol,
      );
      await copyVerified(
        join(staging, "snapshot", "code"),
        join(staging, "work", "code"),
        code,
      );
      await mkdir(join(staging, "work", "inputs"), { recursive: true });
      for (const dataset of datasets)
        await copyVerified(
          join(staging, "snapshot", "inputs", dataset.id),
          join(staging, "work", "inputs", dataset.id),
          dataset.files,
        );
      await mkdir(join(staging, "outputs"));
      const command =
        request.runtime === "uv"
          ? [
              join(target, "work", ".venv", "bin", "python"),
              request.entrypoint,
              ...(request.args ?? []),
            ]
          : ["python3", request.entrypoint, ...(request.args ?? [])];
      const record: RunRecord = {
        schemaVersion: 1,
        id: request.runId,
        labId: request.labId,
        experimentId: request.experimentId,
        status: "queued",
        createdAt,
        snapshotHash: snapshot.sha256,
        metrics: [],
        artifacts: [],
        command,
      };
      await atomicJson(join(staging, "run.json"), record);
      await writeBytes(staging, "stdout.log", "");
      await writeBytes(staging, "stderr.log", "");
      await rename(staging, target);
      return record;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
