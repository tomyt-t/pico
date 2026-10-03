import type { Database } from "bun:sqlite";
import { AgentResources } from "./agent-resources";
import type {
  AgentDefinition,
  AgentDefinitionPatch,
  AgentModelInput,
  ModelSummary,
} from "./contracts";
import { thinkingLevels } from "./contracts";
import { now } from "./db";
import { badRequest, notFound } from "./errors";

const profiles = [
  {
    id: "campaign-coordinator",
    skillId: "campaign-coordination",
    name: "Campaign Coordinator",
    description:
      "Pursue a bounded research objective with a persistent session and specialist agents.",
    whenToUse:
      "Use start_campaign for autonomous investigations with an explicit objective and deliverable. This profile is not an ephemeral worker.",
    instructions:
      "Own the campaign objective and deliverable. Plan, delegate independent scopes, integrate evidence and adapt the approach. Keep campaign_progress current and explain meaningful milestones for Pico. Read persisted worker results and jobs before resuming interrupted work. Report evidence, limitations and pending questions; an inconclusive answer can be a valid deliverable. Request user input when scope or resources require their decision. Never create another campaign or increase your own budget. Send editorial requests and record ids in milestone summaries so Pico can coordinate the shared Research Editor and Panorama.",
  },
  {
    id: "bibliography",
    skillId: "literature-review",
    name: "Literature Researcher",
    description:
      "Find and compare sources, methods, evidence and research gaps.",
    whenToUse:
      "Find and synthesize relevant literature, sources, methods and datasets. Assign independent search scopes to parallel instances.",
    instructions:
      "Find and read relevant sources. Verify references against the sources themselves; never invent citations. Compare what the works actually support, separate observations from interpretations, and describe gaps and limits of the search. Save useful sources and research records. Return a synthesis with references, relevant record ids and paths, evidence, disagreements and open questions. Ask Pico to use critical analysis for difficult interpretations when appropriate.",
  },
  {
    id: "experimentation",
    skillId: "research-experiment",
    name: "Experimenter",
    description:
      "Design experiments, prepare data, implement and run protocols.",
    whenToUse:
      "Design protocols and reproducible experiments; prepare data, implement, execute and analyze measurements.",
    instructions:
      "Turn the assigned question into a concrete protocol before coding. Define the comparison, controls, metrics and how different outcomes would bear on the hypothesis. Prepare data, implement, run and diagnose problems. Record procedures, outputs, negative or inconclusive observations and limitations so the work can be reproduced. Preserve shared work. For long executions use run_job, report job ids and pending work to Pico, and do not wait in polling loops. Return the protocol, relevant code paths and record ids, actual measurements and their limitations; never claim an unfinished job has produced a result.",
  },
  {
    id: "critical-analysis",
    skillId: "critical-review",
    name: "Critical Analyst",
    description: "Develop hypotheses, review protocols and assess evidence.",
    whenToUse:
      "Formulate testable hypotheses and alternative explanations; review a protocol before execution or assess evidence and conclusions afterward.",
    instructions:
      "Evaluate whether the evidence supports the claims. Before execution, formulate testable hypotheses and alternative explanations and assess whether the proposed experiment can distinguish them. After execution, examine controls, uncertainty, confounding factors, possible refutations and limits of generalization. Retain negative and inconclusive results. Ground criticism in the available evidence and distinguish known problems from possibilities. Record useful findings and propose concrete checks that would reduce uncertainty. Return an assessment, relevant references and record ids, limitations and suggested next steps to Pico.",
  },
  {
    id: "research-editor",
    skillId: "research-editorial",
    name: "Research Editor",
    description: "Explain research and maintain the Panorama and topic pages.",
    whenToUse:
      "After consolidating meaningful research progress, revise the Panorama and affected research pages. Also recover pending, partial or interrupted editorial work.",
    instructions:
      "Make the laboratory understandable to the researcher. Begin with review_pages, inspect existing pages, then read the changed records, their history and relevant files. Your run covers research record versions present at its start; later changes remain pending for a later pass. Check every page for relevance to the changes, explicitly reviewing unchanged pages too. Maintain one Panorama with the current question, understanding, evidence, limitations, open questions and next paths. Topic pages develop one question in depth. Reuse existing page ids for the same topic and preserve their revisions; create a new page only for a distinct topic with substance. Write an explanatory narrative in markdown blocks, interleaving claims with selected evidence and interpreted figures. Do not repeat the page title in the first block. Keep body as a readable summary, and avoid large undifferentiated lists of record cards. Distinguish observations, interpretations and hypotheses; explain when a later result revises an earlier conclusion. Inspect figures and their labels, verify structured references, and ask Pico to involve experimentation or critical analysis for scientific or plotting problems. Preserve useful partial content and record unresolved issues rather than claiming they are fixed. Before overwriting a page, re-read its current revision and reconcile other authors' edits. After saving or reviewing each page, call review_pages with its id, observed revision, a short summary and any pending issues; this records coverage without changing the scientific content. review_pages also returns form warnings per page (shape): fix them before finishing, and leave the rest as explicit pending issues. Read new artifact references through read_records before acknowledging an unchanged page. Re-read the returned coverage, report remaining issues, and never equate an ended run with completed editorial work. Return page ids, a summary of changes and pending work to Pico. Do not repeatedly spawn work or poll for new results.",
  },
];

interface Row
  extends Omit<AgentDefinition, "whenToUse" | "updatedAt" | "skillId"> {
  skill_id: string | null;
  when_to_use: string;
  updated_at: string;
}

const view = ({
  when_to_use,
  updated_at,
  skill_id,
  ...row
}: Row): AgentDefinition => ({
  ...row,
  whenToUse: when_to_use,
  skillId: skill_id,
  updatedAt: updated_at,
});

export class AgentCatalog {
  constructor(
    private readonly db: Database,
    private readonly models: () => Promise<ModelSummary[]>,
    private readonly resources = new AgentResources(db),
  ) {
    // Seeds never overwrite choices or prompts already stored in the database.
    for (const profile of profiles)
      db.run(
        "INSERT OR IGNORE INTO agent_definitions (id, name, description, when_to_use, instructions, updated_at, skill_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          profile.id,
          profile.name,
          profile.description,
          profile.whenToUse,
          profile.instructions,
          now(),
          profile.skillId,
        ],
      );
    // Attach the primary skill to pre-skill profiles. Preserve model choices and customized prompts.
    for (const profile of profiles)
      db.run(
        "UPDATE agent_definitions SET skill_id = ? WHERE id = ? AND skill_id IS NULL",
        [profile.skillId, profile.id],
      );
  }

  list(): AgentDefinition[] {
    return (
      this.db
        .query("SELECT * FROM agent_definitions ORDER BY rowid")
        .all() as Row[]
    ).map(view);
  }

  get(id: string): AgentDefinition {
    const row = this.db
      .query("SELECT * FROM agent_definitions WHERE id = ?")
      .get(id) as Row | null;
    if (!row) throw notFound(`Agent ${id} not found`);
    return view(row);
  }

  async update(
    id: string,
    patch: AgentDefinitionPatch,
  ): Promise<AgentDefinition> {
    const current = this.get(id);
    if (!patch || typeof patch !== "object")
      throw badRequest("An agent patch is required");
    const updated = { ...current };
    for (const key of [
      "name",
      "description",
      "whenToUse",
      "instructions",
    ] as const) {
      if (patch[key] === undefined) continue;
      if (typeof patch[key] !== "string" || !patch[key].trim())
        throw badRequest(`${key} must be a non-empty string`);
      updated[key] = patch[key];
    }
    if (patch.skillId !== undefined) {
      this.resources.skill(patch.skillId);
      updated.skillId = patch.skillId;
    }
    if (
      patch.provider !== undefined ||
      patch.model !== undefined ||
      patch.thinking !== undefined
    )
      await this.configure(id, {
        provider: patch.provider ?? current.provider ?? "",
        model: patch.model ?? current.model ?? "",
        thinking: patch.thinking ?? current.thinking,
      });
    this.db.run(
      "UPDATE agent_definitions SET name=?, description=?, when_to_use=?, instructions=?, skill_id=?, updated_at=? WHERE id=?",
      [
        updated.name,
        updated.description,
        updated.whenToUse,
        updated.instructions,
        updated.skillId,
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  async configure(
    id: string,
    input: AgentModelInput,
  ): Promise<AgentDefinition> {
    this.get(id);
    if (
      !input ||
      typeof input.provider !== "string" ||
      !input.provider.trim() ||
      typeof input.model !== "string" ||
      !input.model.trim()
    )
      throw badRequest("provider and model are required");
    if (!thinkingLevels.includes(input.thinking))
      throw badRequest("Invalid thinking level");
    const selected = (await this.models()).find(
      (model) => model.provider === input.provider && model.id === input.model,
    );
    if (!selected)
      throw badRequest(
        `Model ${input.provider}/${input.model} is not available`,
      );
    this.db.run(
      "UPDATE agent_definitions SET provider = ?, model = ?, thinking = ?, updated_at = ? WHERE id = ?",
      [
        input.provider,
        input.model,
        selected.reasoning ? input.thinking : "off",
        now(),
        id,
      ],
    );
    return this.get(id);
  }
}
