import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyMigrations } from "@/lab/storage/migrations/migrate";
export class DatabaseConnection {
  readonly dataDir: string;
  readonly database: Database;
  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(join(this.dataDir, "labs"), { recursive: true });
    this.database = new Database(join(this.dataDir, "pico.sqlite"), {
      create: true,
      strict: true,
    });
    this.database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    applyMigrations(this.database);
  }
  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation).immediate();
  }
  close(): void {
    this.database.close();
  }
}
