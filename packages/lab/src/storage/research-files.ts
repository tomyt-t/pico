import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type DatasetManifest,
  type FileDigest,
  type FileInput,
  fileAccess,
  RunnerError,
} from "@pico/runner";
import type { Actor, Run } from "@/lab/contracts";

const {
  ensureDirectory,
  safeId,
  decodeFile,
  writeBytes,
  readBytes,
  listFiles,
  safeRelative,
  MAX_TREE_FILES,
  MAX_TREE_BYTES,
  digest,
  exists,
  atomicJson,
  readJson,
} = fileAccess;
interface DatasetInput {
  labId: string;
  id: string;
  name: string;
  source: string;
  license: string;
  files: FileInput[];
  version?: string;
  description?: string;
  splits?: Record<string, number>;
  author?: Actor;
}
/** Laboratory-owned datasets, editable workspaces and scientific run metadata. */
export class ResearchFiles {
  readonly root: string;
  constructor(root: string) {
    this.root = realpathSync(root);
  }
  datasetDir(labId: string, id: string): string {
    return join(join(this.root, "labs", safeId(labId)), "datasets", safeId(id));
  }
  async workspace(labId: string, experimentId: string): Promise<string> {
    return ensureDirectory(
      this.root,
      `labs/${safeId(labId)}/experiments/${safeId(experimentId)}/workspace`,
    );
  }
  async writeFile(
    labId: string,
    experimentId: string,
    file: FileInput,
  ): Promise<FileDigest> {
    const root = await this.workspace(labId, experimentId);
    const bytes = decodeFile(file);
    await writeBytes(root, file.path, bytes);
    return { path: file.path, bytes: bytes.length, sha256: digest(bytes) };
  }
  async readFile(
    labId: string,
    experimentId: string,
    path: string,
  ): Promise<FileInput> {
    const bytes = await readBytes(
      await this.workspace(labId, experimentId),
      path,
    );
    const binary =
      bytes.includes(0) ||
      Buffer.from(bytes.toString("utf8")).compare(bytes) !== 0;
    return {
      path,
      content: bytes.toString(binary ? "base64" : "utf8"),
      encoding: binary ? "base64" : "utf8",
    };
  }
  async listFiles(labId: string, experimentId: string): Promise<FileDigest[]> {
    return listFiles(await this.workspace(labId, experimentId));
  }

  async registerDataset(input: DatasetInput): Promise<DatasetManifest> {
    if (!input.name.trim() || !input.source.trim() || !input.license.trim())
      throw new RunnerError(
        "Dataset requires name, source and license (use 'unknown' when unknown)",
      );
    if (!input.files.length || input.files.length > MAX_TREE_FILES)
      throw new RunnerError("Dataset requires 1–2000 files");
    const target = this.datasetDir(input.labId, input.id);
    const temporary = `${target}.pending-${randomUUID()}`;
    await ensureDirectory(this.root, `labs/${safeId(input.labId)}/datasets`);
    await mkdir(temporary);
    try {
      const names = new Set<string>();
      let size = 0;
      await mkdir(join(temporary, "files"));
      for (const file of input.files) {
        safeRelative(file.path);
        if (names.has(file.path))
          throw new RunnerError("Duplicate dataset path");
        names.add(file.path);
        const bytes = decodeFile(file);
        size += bytes.length;
        if (size > MAX_TREE_BYTES)
          throw new RunnerError("Dataset exceeds baseline size limit");
        await writeBytes(join(temporary, "files"), file.path, bytes);
      }
      const files = await listFiles(join(temporary, "files"));
      const sha256 = digest(
        JSON.stringify({
          name: input.name,
          source: input.source,
          license: input.license,
          version: input.version,
          description: input.description,
          splits: input.splits,
          files,
        }),
      );
      const manifest: DatasetManifest = {
        schemaVersion: 1,
        labId: input.labId,
        id: input.id,
        name: input.name,
        source: input.source,
        license: input.license,
        createdAt: new Date().toISOString(),
        files,
        sha256,
        version: input.version,
        description: input.description,
        splits: input.splits,
        author: input.author,
      };
      if (await exists(target)) {
        const previous = await this.getDataset(input.labId, input.id);
        if (previous.sha256 !== sha256)
          throw new RunnerError(
            "Dataset version is immutable; create a new version identifier",
            "conflict",
          );
        return previous;
      }
      await atomicJson(join(temporary, "manifest.json"), manifest);
      await rename(temporary, target);
      return manifest;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  async getDataset(labId: string, id: string): Promise<DatasetManifest> {
    return readJson(this.datasetDir(labId, id), "manifest.json");
  }
  async readDatasetFile(
    labId: string,
    id: string,
    path: string,
  ): Promise<Buffer> {
    const manifest = await this.getDataset(labId, id);
    const file = manifest.files.find((item) => item.path === path);
    if (!file)
      throw new RunnerError(
        "File is not part of this dataset version",
        "missing",
      );
    const bytes = await readBytes(
      join(this.datasetDir(labId, id), "files"),
      path,
    );
    if (digest(bytes) !== file.sha256)
      throw new RunnerError("Dataset file integrity check failed", "conflict");
    return bytes;
  }

  async preserveRun(run: Run): Promise<void> {
    const root = await ensureDirectory(
      this.root,
      `labs/${safeId(run.labId)}/run-records`,
    );
    const path = `${safeId(run.id)}.json`;
    if (await exists(join(root, path))) {
      const previous = await readJson<Run>(root, path);
      if (
        previous.experimentId !== run.experimentId ||
        previous.referenceRunId !== run.referenceRunId
      )
        throw new RunnerError("Run identifier is already in use", "conflict");
    } else await atomicJson(join(root, path), run);
  }
  readRun(labId: string, id: string): Promise<Run> {
    return readJson(
      join(this.root, "labs", safeId(labId), "run-records"),
      `${safeId(id)}.json`,
    );
  }
  async hasRun(labId: string, id: string): Promise<boolean> {
    return exists(
      join(
        this.root,
        "labs",
        safeId(labId),
        "run-records",
        `${safeId(id)}.json`,
      ),
    );
  }
}
