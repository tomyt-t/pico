import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { executionControlFiles } from "@pico/runner";
import { canonicalJson, hash } from "@/lab/storage/canonical-json";
import { DatabaseConnection } from "@/lab/storage/database";
import { StorageConflict } from "@/lab/storage/errors";

interface BackupManifest {
  format: "pico-backup-v1";
  createdAt: string;
  files: { path: string; sha256: string; bytes: number }[];
}

export class ResearchBackup {
  constructor(private readonly connection: DatabaseConnection) {}
  /** Quiescent backup: running jobs and model turns must finish before files can be copied. */
  create(destination: string): string {
    const target = resolve(destination);
    if (
      target === this.connection.dataDir ||
      target.startsWith(`${this.connection.dataDir}${sep}`)
    ) {
      throw new StorageConflict(
        "Backup destination must be outside the data directory",
      );
    }
    if (existsSync(target))
      throw new StorageConflict("Backup destination already exists");
    const stage = `${target}.tmp-${randomUUID()}`;
    mkdirSync(stage, { recursive: true });
    try {
      this.connection.transaction(() => {
        const busy = this.connection.database
          .query<{ count: number }, []>(`
      SELECT count(*) AS count FROM records
      WHERE (kind = 'run' AND json_extract(data, '$.status') IN ('queued','preparing','running'))
         OR (kind = 'turn' AND json_extract(data, '$.status') IN ('queued','running','pending'))
         OR (kind = 'effect' AND json_extract(data, '$.state') = 'pending')
    `)
          .get();
        if (busy?.count)
          throw new StorageConflict(
            "Wait for active runs and turns and filesystem operations before backing up the laboratory",
          );
        writeFileSync(
          join(stage, "pico.sqlite"),
          this.connection.database.serialize(),
        );
        copyTree(
          join(this.connection.dataDir, "labs"),
          join(stage, "labs"),
          (path) => {
            const parts = relative(this.connection.dataDir, path).split(sep);
            // Runtime copies and virtual environments are disposable. Preserved inputs,
            // code, protocol and configuration live in snapshot/, which is copied.
            return (
              parts.length === 5 &&
              parts[0] === "labs" &&
              parts[2] === "runs" &&
              (parts[4] === "work" || operationalIdentity.has(parts[4] ?? ""))
            );
          },
        );
      });
      const manifest: BackupManifest = {
        format: "pico-backup-v1",
        createdAt: new Date().toISOString(),
        files: manifestFiles(stage),
      };
      writeFileSync(
        join(stage, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
      renameSync(stage, target);
      return target;
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }

  static restore(source: string, destination: string): void {
    const backup = resolve(source);
    const target = resolve(destination);
    if (existsSync(target))
      throw new StorageConflict("Restore destination must not exist");
    if (target.startsWith(`${backup}${sep}`))
      throw new StorageConflict(
        "Restore destination must be outside the backup",
      );
    const manifestPath = join(backup, "manifest.json");
    if (!lstatSync(manifestPath).isFile())
      throw new StorageConflict("Invalid backup manifest");
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as BackupManifest;
    if (
      manifest.format !== "pico-backup-v1" ||
      !Array.isArray(manifest.files)
    ) {
      throw new StorageConflict("Unsupported backup format");
    }
    const actual = manifestFiles(backup).filter(
      (file) => file.path !== "manifest.json",
    );
    if (canonicalJson(actual) !== canonicalJson(manifest.files)) {
      throw new StorageConflict(
        "Backup contents do not match their integrity manifest",
      );
    }
    if (!actual.some((file) => file.path === "pico.sqlite"))
      throw new StorageConflict("Backup database missing");
    const stage = `${target}.tmp-${randomUUID()}`;
    try {
      copyTree(backup, stage);
      rmSync(join(stage, "manifest.json"));
      if (
        canonicalJson(manifestFiles(stage)) !== canonicalJson(manifest.files)
      ) {
        throw new StorageConflict("Backup changed while it was being restored");
      }
      discardOperationalIdentity(stage);
      const restored = new DatabaseConnection(stage);
      try {
        const active = restored.database
          .query<{ count: number }, []>(
            "SELECT count(*) AS count FROM records WHERE (kind='run' AND json_extract(data,'$.status') IN ('queued','running','preparing')) OR (kind='turn' AND json_extract(data,'$.status') IN ('queued','running','pending')) OR (kind='effect' AND json_extract(data,'$.state')='pending')",
          )
          .get();
        if (active?.count)
          throw new StorageConflict(
            "Backup contains unresolved active state; restore cannot authorize execution",
          );
        const integrity = restored.database
          .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
          .get();
        if (integrity?.integrity_check !== "ok")
          throw new StorageConflict(
            "Backup database failed its integrity check",
          );
      } finally {
        restored.close();
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(stage, target);
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
}
function copyTree(
  source: string,
  destination: string,
  skip?: (path: string) => boolean,
): void {
  if (skip?.(source)) return;
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source).sort())
      copyTree(join(source, entry), join(destination, entry), skip);
  } else if (stat.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  } else {
    throw new StorageConflict(
      "Research backups cannot contain symlinks or special files",
    );
  }
}

function manifestFiles(root: string): BackupManifest["files"] {
  const files: BackupManifest["files"] = [];
  const visit = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else if (stat.isFile()) {
      const bytes = readFileSync(path);
      files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: hash(bytes),
        bytes: bytes.length,
      });
    } else
      throw new StorageConflict(
        "Research backups cannot contain symlinks or special files",
      );
  };
  visit(root);
  return files;
}

const operationalIdentity = new Set<string>(executionControlFiles);
/** Compatibility reader verifies v1 bytes before discarding process identities. */
function discardOperationalIdentity(root: string): void {
  const labs = join(root, "labs");
  if (!existsSync(labs)) return;
  for (const lab of readdirSync(labs, { withFileTypes: true })) {
    if (!lab.isDirectory()) continue;
    const runs = join(labs, lab.name, "runs");
    if (!existsSync(runs)) continue;
    for (const run of readdirSync(runs, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const directory = join(runs, run.name);
      const record = join(directory, "run.json");
      if (existsSync(record)) {
        const value = JSON.parse(readFileSync(record, "utf8")) as {
          status?: string;
        };
        if (
          ![
            "succeeded",
            "failed",
            "cancelled",
            "timed_out",
            "interrupted",
          ].includes(value.status ?? "")
        )
          throw new StorageConflict(
            "Backup contains an unresolved operational run; restore cannot authorize execution",
          );
      }
      for (const name of operationalIdentity)
        rmSync(join(directory, name), { force: true });
    }
  }
}
