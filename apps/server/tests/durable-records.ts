import { Database } from "bun:sqlite";
import { join } from "node:path";
/** Inspect the durable bytes of a synthetic test directory without importing private engine modules. */
export function durableRecords(dataDir: string, kind: string): unknown[] {
  const db = new Database(join(dataDir, "pico.sqlite"), { readonly: true });
  try {
    return db
      .query<{ data: string }, [string]>(
        "SELECT data FROM records WHERE kind = ?",
      )
      .all(kind)
      .map((row) => JSON.parse(row.data));
  } finally {
    db.close();
  }
}
