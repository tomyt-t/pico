import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentResources } from "./agent-resources";
import type { PicoPaths } from "./config";
import {
  type CreateLabInput,
  type Lab,
  type LabContext,
  type LabPatch,
  thinkingLevels,
} from "./contracts";
import { now } from "./db";
import { badRequest, notFound } from "./errors";
import { ensureRepository } from "./git";
import { workspaceGitignore } from "./prompt";

export type { CreateLabInput, Lab, LabPatch };
export { thinkingLevels };

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

interface Row {
  id: string;
  name: string;
  path: string;
  research_line: string;
  provider: string | null;
  model: string | null;
  thinking: string;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: Row): Lab => ({
  id: row.id,
  name: row.name,
  path: row.path,
  researchLine: row.research_line,
  provider: row.provider,
  model: row.model,
  thinking: row.thinking,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class Labs {
  constructor(
    private readonly db: Database,
    readonly paths: PicoPaths,
    private readonly resources = new AgentResources(db),
  ) {
    // A null column means the existing file has never been imported. Empty text is intentional.
    for (const lab of this.list()) this.context(lab.id);
  }

  context(id: string): LabContext {
    const lab = this.get(id);
    const row = this.db
      .query(
        "SELECT context_markdown, context_revision, context_updated_at FROM labs WHERE id=?",
      )
      .get(id) as {
      context_markdown: string | null;
      context_revision: number;
      context_updated_at: string | null;
    };
    if (row.context_markdown === null) {
      const path = join(lab.path, "PICO.md");
      const content = existsSync(path)
        ? readFileSync(path, "utf8")
        : this.resources.initialContext(lab);
      return this.saveContext(
        id,
        content,
        existsSync(path) ? "migration:PICO.md" : "pico:initial-context",
      );
    }
    return {
      content: row.context_markdown,
      revision: row.context_revision,
      updatedAt: row.context_updated_at ?? lab.updatedAt,
    };
  }

  saveContext(id: string, content: string, author: string): LabContext {
    this.get(id);
    if (typeof content !== "string")
      throw badRequest("content must be a string");
    const timestamp = now();
    this.db.transaction(() => {
      this.db.run(
        "UPDATE labs SET context_markdown=?, context_revision=context_revision+1, context_updated_at=? WHERE id=?",
        [content, timestamp, id],
      );
      this.db.run(
        "INSERT INTO lab_context_revisions (lab_id, revision, content, author, created_at) SELECT id, context_revision, context_markdown, ?, ? FROM labs WHERE id=?",
        [author, timestamp, id],
      );
    })();
    return this.context(id);
  }

  contextHistory(id: string) {
    this.context(id);
    return this.db
      .query(
        "SELECT revision, content, author, created_at AS createdAt FROM lab_context_revisions WHERE lab_id=? ORDER BY revision DESC",
      )
      .all(id);
  }

  list(): Lab[] {
    return (
      this.db.query("SELECT * FROM labs ORDER BY created_at").all() as Row[]
    ).map(fromRow);
  }

  find(id: string): Lab | undefined {
    const row = this.db
      .query("SELECT * FROM labs WHERE id = ?")
      .get(id) as Row | null;
    return row ? fromRow(row) : undefined;
  }

  get(id: string): Lab {
    const lab = this.find(id);
    if (!lab) throw notFound(`Laboratory ${id} not found`);
    return lab;
  }

  async create(input: CreateLabInput): Promise<Lab> {
    const name = input.name?.trim();
    if (!name) throw badRequest("name is required");
    const id = slugify(name);
    if (!id) throw badRequest("name must contain letters or digits");
    if (this.find(id)) throw badRequest(`Laboratory ${id} already exists`);
    const thinking = input.thinking ?? "medium";
    if (!(thinkingLevels as readonly string[]).includes(thinking))
      throw badRequest(`thinking must be one of ${thinkingLevels.join(", ")}`);
    const timestamp = now();
    const lab: Lab = {
      id,
      name,
      path: join(this.paths.labsDir, id),
      researchLine: input.researchLine?.trim() ?? "",
      provider: input.provider ?? null,
      model: input.model ?? null,
      thinking,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await initializeWorkspace(lab);
    this.db.run(
      "INSERT INTO labs (id, name, path, research_line, provider, model, thinking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        lab.id,
        lab.name,
        lab.path,
        lab.researchLine,
        lab.provider,
        lab.model,
        lab.thinking,
        lab.createdAt,
        lab.updatedAt,
      ],
    );
    this.context(lab.id);
    return lab;
  }

  update(id: string, patch: LabPatch): Lab {
    const current = this.get(id);
    const thinking = patch.thinking ?? current.thinking;
    if (!(thinkingLevels as readonly string[]).includes(thinking))
      throw badRequest(`thinking must be one of ${thinkingLevels.join(", ")}`);
    const updated: Lab = {
      ...current,
      name: patch.name?.trim() || current.name,
      researchLine:
        patch.researchLine === undefined
          ? current.researchLine
          : patch.researchLine.trim(),
      provider:
        patch.provider === undefined ? current.provider : patch.provider,
      model: patch.model === undefined ? current.model : patch.model,
      thinking,
      updatedAt: now(),
    };
    this.db.run(
      "UPDATE labs SET name = ?, research_line = ?, provider = ?, model = ?, thinking = ?, updated_at = ? WHERE id = ?",
      [
        updated.name,
        updated.researchLine,
        updated.provider,
        updated.model,
        updated.thinking,
        updated.updatedAt,
        id,
      ],
    );
    return updated;
  }
}

/** Creates the workspace layout. Existing files are never overwritten. */
export async function initializeWorkspace(lab: Lab): Promise<void> {
  for (const dir of ["", "experiments", "papers", "data", ".pico"])
    mkdirSync(join(lab.path, dir), { recursive: true });
  const ignore = join(lab.path, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, workspaceGitignore);
  await ensureRepository(lab.path);
}
