import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { StorageConflict } from "@/lab/storage/errors";

/** SQLite's OS lock gives one application ownership and is released even after a crash. */
export function acquireApplicationLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(join(dataDir, ".pico-owner.sqlite"), {
    create: true,
  });
  try {
    database.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    if (
      error instanceof Error &&
      "code" in error &&
      String(error.code).startsWith("SQLITE_BUSY")
    ) {
      throw new StorageConflict(
        "Another Pico application is already using this data directory",
      );
    }
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  };
}
