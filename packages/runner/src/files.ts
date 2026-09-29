import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TREE_BYTES = 128 * 1024 * 1024;
export const MAX_TREE_FILES = 2_000;
export interface FileLimits {
  maxFileBytes: number;
  maxTreeBytes: number;
  maxFiles: number;
}
/** Local directory imports are streamed; JSON uploads and output collection keep smaller limits. */
export const LOCAL_DATASET_LIMITS: Readonly<FileLimits> = Object.freeze({
  maxFileBytes: 1024 * 1024 * 1024,
  maxTreeBytes: 16 * 1024 * 1024 * 1024,
  maxFiles: 2_000,
});
export function fileLimits(input: Partial<FileLimits> = {}): FileLimits {
  const limits = {
    maxFileBytes: MAX_FILE_BYTES,
    maxTreeBytes: MAX_TREE_BYTES,
    maxFiles: MAX_TREE_FILES,
    ...input,
  };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  )
    throw new RunnerError("File limits must be positive safe integers");
  return limits;
}
export interface FileDigest {
  path: string;
  bytes: number;
  sha256: string;
}
export interface FileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export class RunnerError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "missing" | "conflict" = "invalid",
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))
    throw new RunnerError("Invalid record identifier");
  return value;
}

export function safeRelative(value: string): string {
  const parts = value.split("/");
  if (
    !value ||
    value.length > 512 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    parts.some((p) => !p || p === "." || p === "..")
  ) {
    throw new RunnerError("File path must be relative without traversal");
  }
  if (
    parts.some(
      (p) =>
        p === ".env" || p.startsWith(".env.") || p === ".git" || p === ".venv",
    )
  )
    throw new RunnerError(
      "Secret and environment files cannot be stored in experiments",
    );
  return value;
}

export function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Refuse symlinks on every component, including the root owned by the application. */
export async function checkedPath(
  root: string,
  path: string,
  createParents = false,
): Promise<string> {
  safeRelative(path);
  const base = resolve(root);
  const target = resolve(base, path);
  if (relative(base, target).startsWith(`..${sep}`))
    throw new RunnerError("Path escapes the workspace");
  const parentParts = base.split(sep).filter(Boolean);
  let cursor: string = sep;
  for (const part of parentParts) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new RunnerError(
        "Workspace root must contain only real directories",
      );
  }
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new RunnerError("Symbolic links are not allowed");
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new RunnerError("File parent is not a directory");
      if (index === parts.length - 1 && !stat.isFile())
        throw new RunnerError("Only regular files are allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (index < parts.length - 1 && createParents) await mkdir(cursor);
      else if (index < parts.length - 1)
        throw new RunnerError("File does not exist", "missing");
    }
  }
  return target;
}

export async function readBytes(
  root: string,
  path: string,
  limit = MAX_FILE_BYTES,
): Promise<Buffer> {
  const target = await checkedPath(root, path);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new RunnerError("File does not exist", "missing");
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RunnerError("Only regular files are allowed");
    if (stat.size > limit) throw new RunnerError(`File exceeds ${limit} bytes`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const chunk = await handle.read(
        bytes,
        length,
        limit + 1 - length,
        length,
      );
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    if (length > limit) throw new RunnerError(`File exceeds ${limit} bytes`);
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export async function writeBytes(
  root: string,
  path: string,
  bytes: Uint8Array | string,
): Promise<void> {
  if (Buffer.byteLength(bytes) > MAX_FILE_BYTES)
    throw new RunnerError(`File exceeds ${MAX_FILE_BYTES} bytes`);
  const target = await checkedPath(root, path, true);
  const temporary = join(dirname(target), `.pico-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await writeBytes(
    dirname(path),
    basename(path),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function readJson<T>(root: string, path: string): Promise<T> {
  return JSON.parse((await readBytes(root, path)).toString("utf8")) as T;
}

/** Stream large datasets without allocating their declared size. */
export async function hashFile(
  root: string,
  path: string,
  limit = MAX_FILE_BYTES,
): Promise<FileDigest> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RunnerError("Invalid file limit");
  const target = await checkedPath(root, path);
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RunnerError("Only regular files are allowed");
    if (stat.size > limit) throw new RunnerError(`File exceeds ${limit} bytes`);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(Math.min(1024 * 1024, limit + 1));
    let bytes = 0;
    for (;;) {
      const chunk = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, limit + 1 - bytes),
        bytes,
      );
      if (!chunk.bytesRead) break;
      bytes += chunk.bytesRead;
      if (bytes > limit) throw new RunnerError(`File exceeds ${limit} bytes`);
      hash.update(buffer.subarray(0, chunk.bytesRead));
    }
    return { path, bytes, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function listFiles(
  root: string,
  options?: Partial<FileLimits>,
): Promise<FileDigest[]> {
  const limits = fileLimits(options);
  const files: FileDigest[] = [];
  let totalBytes = 0;
  let totalEntries = 0;
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 24)
      throw new RunnerError("Directory nesting exceeds 24 levels");
    for (const entry of await readdir(join(root, prefix), {
      withFileTypes: true,
    })) {
      if (++totalEntries > limits.maxFiles * 2)
        throw new RunnerError("Workspace contains too many entries");
      if (
        entry.name === ".venv" ||
        entry.name === "__pycache__" ||
        entry.name === ".git" ||
        entry.name.startsWith(".pico-")
      )
        continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeRelative(path);
      if (entry.isSymbolicLink())
        throw new RunnerError(`Symbolic link is not allowed: ${path}`);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else {
        const file = await hashFile(root, path, limits.maxFileBytes);
        totalBytes += file.bytes;
        if (files.length >= limits.maxFiles || totalBytes > limits.maxTreeBytes)
          throw new RunnerError("Workspace exceeds snapshot limits");
        files.push(file);
      }
    }
  }
  await walk("", 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function decodeFile(input: FileInput): Buffer {
  if (
    input.encoding &&
    input.encoding !== "utf8" &&
    input.encoding !== "base64"
  )
    throw new RunnerError("Unsupported file encoding");
  if (
    input.encoding === "base64" &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.content,
    )
  )
    throw new RunnerError("Invalid base64 file content");
  const bytes = Buffer.from(input.content, input.encoding ?? "utf8");
  if (bytes.length > MAX_FILE_BYTES)
    throw new RunnerError("File exceeds size limit");
  return bytes;
}

export async function copyVerified(
  source: string,
  destination: string,
  manifest?: FileDigest[],
  options?: Partial<FileLimits>,
): Promise<FileDigest[]> {
  const limits = fileLimits(options);
  const files = manifest ?? (await listFiles(source, limits));
  if (
    files.length > limits.maxFiles ||
    files.reduce((sum, file) => sum + file.bytes, 0) > limits.maxTreeBytes
  )
    throw new RunnerError("Workspace exceeds snapshot limits");
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    safeRelative(file.path);
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > limits.maxFileBytes
    )
      throw new RunnerError("Preserved file exceeds configured size limit");
    const input = await checkedPath(source, file.path);
    const sourceInfo = await lstat(input);
    if (!sourceInfo.isFile() || sourceInfo.size > limits.maxFileBytes)
      throw new RunnerError(
        "Source is not a regular file within the configured size limit",
      );
    const target = await checkedPath(destination, file.path, true);
    const temporary = join(dirname(target), `.pico-${randomUUID()}.tmp`);
    try {
      // A CoW clone when supported; portable copy otherwise. Never share writable inodes.
      await copyFile(
        input,
        temporary,
        constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL,
      );
      const copied = await hashFile(
        dirname(temporary),
        basename(temporary),
        limits.maxFileBytes,
      );
      if (copied.bytes !== file.bytes || copied.sha256 !== file.sha256)
        throw new RunnerError(
          `Preserved file was changed: ${file.path}`,
          "conflict",
        );
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return files;
}

/** Fast periodic output accounting. OS isolation and hard disk quotas are outside this local backend. */
export async function checkTreeBudget(root: string): Promise<void> {
  let bytes = 0;
  let entries = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 24)
      throw new RunnerError("Output directory exceeds nesting limit");
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++entries > MAX_TREE_FILES)
        throw new RunnerError("Outputs exceed file count limit");
      if (item.isSymbolicLink())
        throw new RunnerError("Output symbolic links are not allowed");
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path, depth + 1);
      else {
        const stat = await lstat(path);
        if (!stat.isFile())
          throw new RunnerError("Outputs must be regular files");
        bytes += stat.size;
        if (stat.size > MAX_FILE_BYTES || bytes > MAX_TREE_BYTES)
          throw new RunnerError(
            "Outputs exceed size limit (8 MiB per file, 128 MiB total)",
          );
      }
    }
  }
  await visit(root, 0);
}

/** Create each directory only after verifying all existing ancestors. */
export async function ensureDirectory(
  root: string,
  path: string,
): Promise<string> {
  safeRelative(path);
  const base = resolve(root);
  const rootStat = await lstat(base);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new RunnerError("Storage root must be a real directory");
  let current = base;
  for (const component of path.split("/")) {
    current = join(current, component);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RunnerError("Storage paths must contain only real directories");
  }
  return current;
}
