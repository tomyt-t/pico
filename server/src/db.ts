import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const migrations: string[] = [
  `
  CREATE TABLE labs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    research_line TEXT NOT NULL DEFAULT '',
    provider TEXT,
    model TEXT,
    thinking TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT,
    body TEXT NOT NULL DEFAULT '',
    fields TEXT NOT NULL DEFAULT '{}',
    links TEXT NOT NULL DEFAULT '[]',
    author TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX records_lab_kind ON records(lab_id, kind, updated_at);
  CREATE TABLE revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    lab_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX revisions_record ON revisions(record_id, revision);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL,
    pid INTEGER,
    commit_hash TEXT,
    log_path TEXT NOT NULL,
    metrics_path TEXT NOT NULL,
    metrics TEXT,
    exit_code INTEGER,
    error TEXT,
    experiment_id TEXT,
    notified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX jobs_lab ON jobs(lab_id, created_at);
  `,
  // This draft migration was already applied in development; later tables are additive.
  `
  CREATE TABLE subagents (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    task TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT '',
    error TEXT,
    session_file TEXT,
    notified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX subagents_lab ON subagents(lab_id, created_at);
  `,
  `
  CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    when_to_use TEXT NOT NULL,
    instructions TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    thinking TEXT NOT NULL DEFAULT 'medium',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    agent_id TEXT NOT NULL REFERENCES agent_definitions(id),
    name TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    thinking TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT '',
    error TEXT,
    session_file TEXT,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    notified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX agent_runs_lab ON agent_runs(lab_id, created_at);
  `,
  `
  ALTER TABLE agent_runs ADD COLUMN editorial_context TEXT;
  CREATE TABLE page_reviews (
    page_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    page_revision INTEGER NOT NULL,
    files TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    pending TEXT NOT NULL DEFAULT '[]',
    reviewed_at TEXT NOT NULL
  );
  CREATE INDEX page_reviews_lab ON page_reviews(lab_id);
  `,
  `ALTER TABLE page_reviews ADD COLUMN page_refs TEXT NOT NULL DEFAULT '{}';`,
  `
  CREATE TABLE prompt_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE agent_skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    instructions TEXT NOT NULL, examples TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );
  ALTER TABLE agent_definitions ADD COLUMN skill_id TEXT REFERENCES agent_skills(id);
  UPDATE agent_definitions SET name='Literature Researcher' WHERE id='bibliography' AND name='Pesquisa bibliográfica';
  UPDATE agent_definitions SET description='Find and compare sources, methods, evidence and research gaps.' WHERE id='bibliography' AND description='Busca e leitura de fontes, métodos, evidências e lacunas.';
  UPDATE agent_definitions SET name='Experimenter' WHERE id='experimentation' AND name='Experimentação';
  UPDATE agent_definitions SET description='Design experiments, prepare data, implement and run protocols.' WHERE id='experimentation' AND description='Desenho experimental, preparação de dados, código e execução.';
  UPDATE agent_definitions SET name='Critical Analyst' WHERE id='critical-analysis' AND name='Análise crítica';
  UPDATE agent_definitions SET description='Develop hypotheses, review protocols and assess evidence.' WHERE id='critical-analysis' AND description='Hipóteses, revisão de protocolos e avaliação das evidências.';
  UPDATE agent_definitions SET name='Research Editor' WHERE id='research-editor' AND name='Editor de pesquisa';
  UPDATE agent_definitions SET description='Explain research and maintain the Panorama and topic pages.' WHERE id='research-editor' AND description='Síntese explicativa, curadoria e atualização do Panorama e das páginas.';
  ALTER TABLE labs ADD COLUMN context_markdown TEXT;
  ALTER TABLE labs ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE labs ADD COLUMN context_updated_at TEXT;
  CREATE TABLE lab_context_revisions (
    lab_id TEXT NOT NULL REFERENCES labs(id), revision INTEGER NOT NULL,
    content TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(lab_id, revision)
  );
  `,
  `
  CREATE TABLE campaign_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    budget_usd REAL NOT NULL DEFAULT 5,
    max_agents INTEGER NOT NULL DEFAULT 3,
    lab_max_agents INTEGER NOT NULL DEFAULT 6
  );
  INSERT INTO campaign_settings (id) VALUES (1);
  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES labs(id),
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    deliverable TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    context_revision INTEGER NOT NULL DEFAULT 0,
    read_context_revision INTEGER NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT '',
    activity TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    reason TEXT,
    budget_usd REAL NOT NULL,
    max_agents INTEGER NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    thinking TEXT NOT NULL,
    session_file TEXT,
    wake_requested INTEGER NOT NULL DEFAULT 1,
    progress_version INTEGER NOT NULL DEFAULT 0,
    notified_version INTEGER NOT NULL DEFAULT 0,
    notification TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX campaigns_lab ON campaigns(lab_id, created_at);
  ALTER TABLE agent_runs ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);
  ALTER TABLE jobs ADD COLUMN campaign_id TEXT REFERENCES campaigns(id);
  CREATE INDEX agent_runs_campaign ON agent_runs(campaign_id, status);
  CREATE INDEX jobs_campaign ON jobs(campaign_id, status);
  `,
  "ALTER TABLE agent_runs ADD COLUMN label TEXT;",
];

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  // The previous Pico kept a different schema in the same file name.
  if (
    db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mutation_receipts'",
      )
      .get()
  ) {
    db.close();
    throw new Error(
      `${path} was created by a previous version of Pico and cannot be reused. Move or delete pico.sqlite* (the Pi profile in pi/ can stay), or point PICO_DATA_DIR elsewhere.`,
    );
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (
      db.query("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((row) => row.version),
  );
  migrations.forEach((sql, index) => {
    const version = index + 1;
    if (applied.has(version)) return;
    db.transaction(() => {
      db.exec(sql);
      db.run(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        [version, new Date().toISOString()],
      );
    })();
  });
  return db;
}

export const now = (): string => new Date().toISOString();
