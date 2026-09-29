import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  type DatasetManifest,
  type FileDigest,
  type FileInput,
  fileAccess,
  RunnerError,
} from "@pico/runner";
import type { Actor, DatasetDirectoryRegistration, Run } from "@/lab/contracts";

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
  hashFile,
  copyVerified,
  LOCAL_DATASET_LIMITS,
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
type DatasetDirectoryInput = Omit<DatasetInput, "files"> & {
  directory: string;
  limits?: DatasetDirectoryRegistration["limits"];
};
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
  async importDatasetDirectory(
    input: DatasetDirectoryInput,
  ): Promise<DatasetManifest> {
    if (!isAbsolute(input.directory))
      throw new RunnerError("Dataset directory must be an absolute local path");
    if (!input.name.trim() || !input.source.trim() || !input.license.trim())
      throw new RunnerError("Dataset requires name, source and license");
    const limits = { ...LOCAL_DATASET_LIMITS, ...input.limits };
    // Import-specific budgets may tighten the supported local execution ceiling.
    for (const key of ["maxFileBytes", "maxTreeBytes", "maxFiles"] as const)
      if (
        !Number.isSafeInteger(limits[key]) ||
        limits[key] < 1 ||
        limits[key] > LOCAL_DATASET_LIMITS[key]
      )
        throw new RunnerError(
          `Dataset ${key} must be between 1 and ${LOCAL_DATASET_LIMITS[key]}`,
        );
    const target = this.datasetDir(input.labId, input.id);
    if (await exists(target)) {
      const previous = await this.getDataset(input.labId, input.id);
      if (
        previous.name !== input.name ||
        previous.version !== input.version ||
        previous.source !== input.source ||
        previous.license !== input.license ||
        previous.description !== input.description ||
        JSON.stringify(previous.splits) !== JSON.stringify(input.splits)
      )
        throw new RunnerError(
          "Dataset version is immutable; create a new version identifier",
          "conflict",
        );
      await this.verifyDataset(input.labId, input.id);
      return previous;
    }
    const sourceStat = await lstat(input.directory);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())
      throw new RunnerError("Dataset sources must be real directories");
    // Canonicalize OS aliases such as macOS /var before enforcing child-path boundaries.
    const directory = await realpath(input.directory);
    const files = await listFiles(directory, limits);
    if (!files.length)
      throw new RunnerError("Dataset requires at least one file");
    await ensureDirectory(this.root, `labs/${safeId(input.labId)}/datasets`);
    const temporary = `${target}.pending-${randomUUID()}`;
    await mkdir(temporary);
    try {
      await copyVerified(directory, join(temporary, "files"), files, limits);
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
      await atomicJson(join(temporary, "manifest.json"), manifest);
      await rename(temporary, target);
      return manifest;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  async verifyDataset(labId: string, id: string): Promise<void> {
    const manifest = await this.getDataset(labId, id);
    if (manifest.labId !== labId || manifest.id !== id)
      throw new RunnerError(
        "Dataset identity does not match its directory",
        "conflict",
      );
    const root = join(this.datasetDir(labId, id), "files");
    for (const file of manifest.files) {
      const actual = await hashFile(
        root,
        file.path,
        LOCAL_DATASET_LIMITS.maxFileBytes,
      );
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
        throw new RunnerError(
          "Dataset file integrity check failed",
          "conflict",
        );
    }
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
