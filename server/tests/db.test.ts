import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db";

test("a database from the previous Pico is refused with a clear message", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-db-"));
  try {
    const path = join(root, "pico.sqlite");
    const old = new Database(path, { create: true });
    old.exec(
      "CREATE TABLE mutation_receipts (id TEXT PRIMARY KEY); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)",
    );
    old.close();
    expect(() => openDatabase(path)).toThrow("previous version of Pico");
    const fresh = openDatabase(join(root, "new.sqlite"));
    expect(
      fresh
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "agent_definitions" },
      { name: "agent_runs" },
      { name: "agent_skills" },
      { name: "campaign_settings" },
      { name: "campaigns" },
      { name: "jobs" },
      { name: "lab_context_revisions" },
      { name: "labs" },
      { name: "page_reviews" },
      { name: "prompt_templates" },
      { name: "records" },
      { name: "revisions" },
      { name: "schema_migrations" },
      { name: "subagents" },
    ]);
    fresh.close();
    expect(() => openDatabase(join(root, "new.sqlite")).close()).not.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the catalog migration adds tables to an existing development database without altering labs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-migration-"));
  const path = join(root, "pico.sqlite");
  try {
    const db = openDatabase(path);
    db.run(
      "INSERT INTO labs (id, name, path, research_line, created_at, updated_at) VALUES ('lab', 'Existing lab', '/tmp/lab', 'Keep this direction', '2026-10-01', '2026-10-01')",
    );
    // Recreate the already-applied development schema before the catalog existed.
    db.exec(
      "DROP INDEX jobs_campaign; ALTER TABLE jobs DROP COLUMN campaign_id; DROP TABLE campaign_settings; DROP TABLE lab_context_revisions; DROP TABLE prompt_templates; ALTER TABLE labs DROP COLUMN context_markdown; ALTER TABLE labs DROP COLUMN context_revision; ALTER TABLE labs DROP COLUMN context_updated_at; DROP TABLE page_reviews; DROP TABLE agent_runs; DROP TABLE campaigns; DROP TABLE agent_definitions; DROP TABLE agent_skills; DELETE FROM schema_migrations WHERE version >= 3",
    );
    db.close();
    const upgraded = openDatabase(path);
    try {
      expect(
        upgraded
          .query("SELECT name, research_line FROM labs WHERE id = 'lab'")
          .get(),
      ).toEqual({ name: "Existing lab", research_line: "Keep this direction" });
      expect(
        upgraded.query("SELECT COUNT(*) AS count FROM agent_definitions").get(),
      ).toEqual({ count: 0 });
      expect(
        upgraded.query("SELECT COUNT(*) AS count FROM agent_runs").get(),
      ).toEqual({ count: 0 });
      expect(
        upgraded
          .query("SELECT version FROM schema_migrations ORDER BY version")
          .all(),
      ).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
      ]);
    } finally {
      upgraded.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("English profile migration preserves customized instructions, names and model choices", async () => {
  const root = mkdtempSync(join(tmpdir(), "pico-instructions-migration-"));
  const path = join(root, "pico.sqlite");
  try {
    const db = openDatabase(path);
    db.exec(`
      ALTER TABLE agent_definitions DROP COLUMN skill_id;
      DROP TABLE agent_skills;
      DROP TABLE prompt_templates;
      DROP TABLE lab_context_revisions;
      ALTER TABLE labs DROP COLUMN context_markdown;
      ALTER TABLE labs DROP COLUMN context_revision;
      ALTER TABLE labs DROP COLUMN context_updated_at;
      DELETE FROM schema_migrations WHERE version=6;
    `);
    db.run(
      "INSERT INTO agent_definitions (id,name,description,when_to_use,instructions,provider,model,thinking,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        "bibliography",
        "Pesquisa bibliográfica",
        "Busca e leitura de fontes, métodos, evidências e lacunas.",
        "My scope",
        "Custom prompt",
        "fake",
        "chosen-model",
        "high",
        "2026-10-01",
      ],
    );
    db.run(
      "INSERT INTO agent_definitions (id,name,description,when_to_use,instructions,updated_at) VALUES (?,?,?,?,?,?)",
      [
        "research-editor",
        "Meu editor",
        "Minha descrição",
        "My scope",
        "Custom editorial prompt",
        "2026-10-01",
      ],
    );
    db.close();
    const migrated = openDatabase(path);
    try {
      expect(
        migrated
          .query(
            "SELECT name, instructions, provider, model, thinking FROM agent_definitions WHERE id='bibliography'",
          )
          .get(),
      ).toEqual({
        name: "Literature Researcher",
        instructions: "Custom prompt",
        provider: "fake",
        model: "chosen-model",
        thinking: "high",
      });
      expect(
        migrated
          .query(
            "SELECT name, description FROM agent_definitions WHERE id='research-editor'",
          )
          .get(),
      ).toEqual({ name: "Meu editor", description: "Minha descrição" });
    } finally {
      migrated.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
