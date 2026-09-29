import type { Migration } from "@/lab/storage/migrations/migrate";
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "durable_laboratory",
    sql: `
      CREATE TABLE records (
        id TEXT PRIMARY KEY,
        lab_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL CHECK (json_valid(data)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX records_lab_kind ON records(lab_id, kind, created_at);
      CREATE TABLE revisions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id TEXT NOT NULL REFERENCES records(id),
        lab_id TEXT NOT NULL,
        data TEXT NOT NULL CHECK (json_valid(data)),
        reason TEXT NOT NULL,
        author TEXT NOT NULL CHECK (json_valid(author)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX revisions_record ON revisions(record_id, sequence);
      CREATE TABLE mutation_receipts (
        lab_id TEXT NOT NULL,
        key TEXT NOT NULL,
        operation TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result TEXT NOT NULL CHECK (json_valid(result)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (lab_id, key)
      );
    `,
  },
];
