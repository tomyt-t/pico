import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
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

export async function listFiles(root: string): Promise<FileDigest[]> {
  const files: FileDigest[] = [];
  let totalBytes = 0;
  let totalEntries = 0;
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 24)
      throw new RunnerError("Directory nesting exceeds 24 levels");
    for (const entry of await readdir(join(root, prefix), {
      withFileTypes: true,
    })) {
      if (++totalEntries > MAX_TREE_FILES * 2)
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
        const bytes = await readBytes(root, path);
        totalBytes += bytes.length;
        if (files.length >= MAX_TREE_FILES || totalBytes > MAX_TREE_BYTES)
          throw new RunnerError("Workspace exceeds snapshot limits");
        files.push({ path, bytes: bytes.length, sha256: digest(bytes) });
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
): Promise<FileDigest[]> {
  const files = manifest ?? (await listFiles(source));
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const bytes = await readBytes(source, file.path);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new RunnerError(
        `Preserved file was changed: ${file.path}`,
        "conflict",
      );
    await writeBytes(destination, file.path, bytes);
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
