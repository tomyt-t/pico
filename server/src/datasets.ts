import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { badRequest } from "./errors";
import { newId } from "./ids";
import type { Lab } from "./labs";
import { slugify } from "./labs";
import { resolveUserPath } from "./paths";
import type { Records, ResearchRecord } from "./records";

export interface DatasetInput {
  name: string;
  path?: string;
  url?: string;
  source?: string;
  license?: string;
  description?: string;
  id?: string;
}

export interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

const skipped = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".pico",
  ".venv",
]);

/** A relative path with "/" separators, so manifests and their hashes are
 *  the same on every system. */
const portable = (from: string, to: string): string =>
  relative(from, to).split(sep).join("/");

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

export async function manifestOf(root: string): Promise<ManifestEntry[]> {
  const info = statSync(root);
  if (info.isFile())
    return [
      { path: basename(root), bytes: info.size, sha256: await hashFile(root) },
    ];
  const entries: ManifestEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      if (skipped.has(item.name)) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        const stat = statSync(path);
        entries.push({
          path: portable(root, path),
          bytes: stat.size,
          sha256: await hashFile(path),
        });
      }
    }
  }
  await walk(root);
  return entries;
}

export async function registerDataset(
  lab: Lab,
  records: Records,
  input: DatasetInput,
  author: string,
): Promise<ResearchRecord> {
  const name = input.name?.trim();
  if (!name) throw badRequest("name is required");
  let path: string;
  if (input.url) {
    const url = new URL(input.url);
    const dir = join(lab.path, "data", slugify(name) || "dataset");
    mkdirSync(dir, { recursive: true });
    const file = basename(url.pathname) || "download";
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok || !response.body)
      throw badRequest(`Download failed: HTTP ${response.status}`);
    await Bun.write(join(dir, file), response);
    path = dir;
  } else if (input.path) {
    path = resolveUserPath(lab.path, input.path);
    if (!existsSync(path)) throw badRequest(`Path does not exist: ${path}`);
  } else throw badRequest("path or url is required");
  const manifest = await manifestOf(path);
  if (!manifest.length) throw badRequest("The dataset has no files");
  const id = input.id?.trim() || newId("d");
  const manifestHash = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  const manifestDir = join(lab.path, ".pico", "datasets");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, `${id}.json`);
  await writeFile(
    manifestPath,
    `${JSON.stringify({ id, name, path, sha256: manifestHash, files: manifest }, null, 2)}\n`,
  );
  // Another drive on Windows gives an absolute relative path, not "..".
  const fromLab = relative(lab.path, path);
  const inside = !fromLab.startsWith("..") && !isAbsolute(fromLab);
  return records.save(
    lab.id,
    {
      id,
      kind: "dataset",
      title: name,
      body: input.description ?? "",
      fields: {
        path: inside ? portable(lab.path, path) : path,
        url: input.url ?? null,
        source: input.source ?? null,
        license: input.license ?? null,
        files: manifest.length,
        bytes: manifest.reduce((sum, entry) => sum + entry.bytes, 0),
        sha256: manifestHash,
        manifest: portable(lab.path, manifestPath),
      },
    },
    author,
  );
}
