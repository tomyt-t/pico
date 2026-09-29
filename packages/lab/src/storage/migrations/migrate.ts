import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

import { migrations } from "@/lab/storage/migrations/001-durable-laboratory";

export { migrations };
/** Each migration and its version marker commit together. Never edit an applied migration. */
export function applyMigrations(
  db: Database,
  steps: readonly Migration[] = migrations,
): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = db
    .query<{ version: number; name: string }, []>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    )
    .all();
  const known = new Map(steps.map((step) => [step.version, step.name]));
  for (const migration of applied) {
    if (known.get(migration.version) !== migration.name) {
      throw new Error(
        `Unsupported database migration ${migration.version}: ${migration.name}`,
      );
    }
  }
  let last = 0;
  for (const step of steps) {
    if (!Number.isInteger(step.version) || step.version <= last) {
      throw new Error(
        "Migrations must have strictly increasing positive versions",
      );
    }
    last = step.version;
    if (applied.some((migration) => migration.version === step.version))
      continue;
    db.transaction(() => {
      db.exec(step.sql);
      db.query(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(step.version, step.name, new Date().toISOString());
    })();
  }
}
