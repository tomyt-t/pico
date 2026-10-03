import type { Database } from "bun:sqlite";
import type {
  AgentDefinition,
  AgentSkill,
  Lab,
  PromptTemplate,
} from "./contracts";
import { now } from "./db";
import { badRequest, notFound } from "./errors";
import { defaultPrompts } from "./prompt-defaults";
import { defaultSkills } from "./skill-defaults";

type SkillRow = Omit<AgentSkill, "updatedAt"> & { updated_at: string };
type PromptRow = Omit<PromptTemplate, "updatedAt"> & { updated_at: string };
const view = <T extends { updated_at: string }>({ updated_at, ...row }: T) => ({
  ...row,
  updatedAt: updated_at,
});

/** Replace only template tokens, never tokens inside the supplied values. */
export function renderPrompt(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{([a-z_]+)\}\}/g,
    (token, key: string) => values[key] ?? token,
  );
}

/** Global, editable instructions. Defaults seed missing rows without overwriting edits. */
export class AgentResources {
  constructor(private readonly db: Database) {
    db.transaction(() => {
      for (const prompt of defaultPrompts)
        db.run(
          "INSERT OR IGNORE INTO prompt_templates (id, name, content, updated_at) VALUES (?, ?, ?, ?)",
          [prompt.id, prompt.name, prompt.content, now()],
        );
      for (const skill of defaultSkills)
        db.run(
          "INSERT OR IGNORE INTO agent_skills (id, name, description, instructions, examples, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            skill.id,
            skill.name,
            skill.description,
            skill.instructions,
            skill.examples,
            now(),
          ],
        );
    })();
  }

  skills(): AgentSkill[] {
    return (
      this.db
        .query("SELECT * FROM agent_skills ORDER BY rowid")
        .all() as SkillRow[]
    ).map(view);
  }

  skill(id: string): AgentSkill {
    const row = this.db
      .query("SELECT * FROM agent_skills WHERE id = ?")
      .get(id) as SkillRow | null;
    if (!row) throw notFound(`Skill ${id} not found`);
    return view(row);
  }

  updateSkill(
    id: string,
    patch: Partial<
      Pick<AgentSkill, "name" | "description" | "instructions" | "examples">
    >,
  ): AgentSkill {
    const current = this.skill(id);
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw badRequest("A skill patch is required");
    const updated = { ...current };
    for (const key of [
      "name",
      "description",
      "instructions",
      "examples",
    ] as const) {
      if (patch?.[key] === undefined) continue;
      if (
        typeof patch[key] !== "string" ||
        (key !== "examples" && !patch[key].trim())
      )
        throw badRequest(
          `${key} must be ${key === "examples" ? "a string" : "a non-empty string"}`,
        );
      updated[key] = patch[key];
    }
    this.db.run(
      "UPDATE agent_skills SET name=?, description=?, instructions=?, examples=?, updated_at=? WHERE id=?",
      [
        updated.name,
        updated.description,
        updated.instructions,
        updated.examples,
        now(),
        id,
      ],
    );
    return this.skill(id);
  }

  prompts(): PromptTemplate[] {
    return (
      this.db
        .query("SELECT * FROM prompt_templates ORDER BY rowid")
        .all() as PromptRow[]
    ).map(view);
  }

  prompt(id: string): PromptTemplate {
    const row = this.db
      .query("SELECT * FROM prompt_templates WHERE id = ?")
      .get(id) as PromptRow | null;
    if (!row) throw notFound(`Prompt ${id} not found`);
    return view(row);
  }

  updatePrompt(id: string, content: string): PromptTemplate {
    this.prompt(id);
    if (typeof content !== "string" || !content.trim())
      throw badRequest("content must be a non-empty string");
    this.db.run(
      "UPDATE prompt_templates SET content=?, updated_at=? WHERE id=?",
      [content, now(), id],
    );
    return this.prompt(id);
  }

  systemPrompt(lab: Lab, worker?: AgentDefinition): string {
    const values = {
      lab_name: lab.name,
      lab_path: lab.path,
      agent_name: worker?.name ?? "Pico",
      agent_instructions: worker?.instructions ?? "",
    };
    return [
      worker?.id === "campaign-coordinator"
        ? "campaign"
        : worker
          ? "worker"
          : "coordinator",
      "shared",
    ]
      .map((id) => renderPrompt(this.prompt(id).content, values))
      .join("\n\n");
  }

  initialContext(lab: Pick<Lab, "name" | "researchLine">): string {
    return renderPrompt(this.prompt("lab-context").content, {
      lab_name: lab.name,
      research_line: lab.researchLine,
    });
  }
}
