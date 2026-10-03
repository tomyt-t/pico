import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import type { Campaigns } from "./campaigns";
import type { AgentSkill } from "./contracts";
import { registerDataset } from "./datasets";
import type { Editorial } from "./editorial";
import { badRequest } from "./errors";
import type { Jobs } from "./jobs";
import type { Lab, Labs } from "./labs";
import { savePaper } from "./papers";
import { type RecordKind, type Records, recordKinds } from "./records";
import type { Subagents } from "./subagents";

export interface ToolDependencies {
  lab: Lab;
  labs?: Labs;
  resources?: AgentResources;
  skillCatalog?: AgentSkill[];
  records: Records;
  jobs: Jobs;
  subagents?: Subagents;
  catalog?: AgentCatalog;
  editorial?: Editorial;
  editorialRunId?: string;
  author?: string;
  campaigns?: Campaigns;
  campaignId?: string | null;
  campaignCoordinator?: boolean;
}

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: undefined,
  };
}

const kindSchema = Type.Union(recordKinds.map((kind) => Type.Literal(kind)));
const linkSchema = Type.Object({
  kind: Type.String({ description: "Kind of the linked record" }),
  id: Type.String({ description: "Id of the linked record" }),
});

export function createPicoTools({
  lab,
  labs,
  resources,
  skillCatalog,
  records,
  jobs,
  subagents,
  catalog,
  editorial,
  editorialRunId,
  campaigns,
  campaignId,
  campaignCoordinator,
  author = "pico",
}: ToolDependencies): ToolDefinition[] {
  const saveRecord = defineTool({
    name: "save_record",
    label: "Save record",
    description:
      "Create or update a structured research record (question, hypothesis, experiment, result, conclusion, note, paper, dataset, page). Pass id to update; omitted fields keep their value and fields are shallow-merged. Links connect records by kind and id. A page presents research using its Markdown body and optional fields.blocks. Set fields.placement='panorama' for the laboratory overview. Updating fields.blocks replaces the entire block list; send all blocks you want to keep.",
    promptSnippet:
      "save_record: create or update a research record the researcher sees in the UI",
    parameters: Type.Object({
      kind: kindSchema,
      id: Type.Optional(
        Type.String({ description: "Existing record id to update" }),
      ),
      title: Type.Optional(
        Type.String({ description: "Short title; required when creating" }),
      ),
      status: Type.Optional(
        Type.String({
          description:
            "Free status, for example open, testing, supported, refuted, inconclusive, draft, done",
        }),
      ),
      body: Type.Optional(
        Type.String({ description: "Markdown body with the substance" }),
      ),
      fields: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description:
            "Free structured fields, for example path, jobId, metrics, confidence. For pages: placement may be 'panorama'; blocks may contain {type:'markdown', text:string}, {type:'records', ids:string[]} or {type:'artifact', path:string, caption?:string}. Artifact paths are relative to the laboratory. Updating blocks replaces the whole list.",
        }),
      ),
      links: Type.Optional(Type.Array(linkSchema)),
      reason: Type.Optional(
        Type.String({ description: "Why the record changed" }),
      ),
    }),
    execute: async (_id, params) => {
      const record = records.save(
        lab.id,
        {
          id: params.id,
          kind: params.kind as RecordKind,
          title: params.title,
          status: params.status,
          body: params.body,
          fields: campaignId
            ? { ...params.fields, campaignId }
            : (params.fields as Record<string, unknown> | undefined),
          links: params.links,
          reason: params.reason,
        },
        author,
      );
      if (editorial && editorialRunId)
        editorial.observe(lab, editorialRunId, record);
      return text({
        saved: record.id,
        kind: record.kind,
        revision: record.revision,
      });
    },
  });

  const readRecords = defineTool({
    name: "read_records",
    label: "Read records",
    description:
      "List research records of this laboratory, optionally by kind or status, or read one record in full by id. Set history=true for creations and revisions, newest first, with before/after content and the author, date and reason of each change. History respects kind and limit, and ignores id and status; references point to current records, not frozen targets.",
    promptSnippet:
      "read_records: list, read or inspect the history of laboratory records",
    parameters: Type.Object({
      kind: Type.Optional(kindSchema),
      id: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      history: Type.Optional(Type.Boolean()),
      limit: Type.Optional(
        Type.Number({
          description:
            "History: default 100, maximum 500. Record lists in this tool: default 100, maximum 5000.",
        }),
      ),
    }),
    execute: async (_id, params) => {
      if (params.history)
        return text(
          records.history(lab.id, { kind: params.kind, limit: params.limit }),
        );
      if (params.id) {
        const record = records.get(lab.id, params.id);
        if (editorial && editorialRunId)
          editorial.observe(lab, editorialRunId, record);
        return text(record);
      }
      const list = records.list(lab.id, {
        kind: params.kind,
        status: params.status,
        limit: params.limit ?? 100,
      });
      return text(
        list.map((record) => ({
          id: record.id,
          kind: record.kind,
          title: record.title,
          status: record.status,
          links: record.links,
          updatedAt: record.updatedAt,
          revision: record.revision,
          summary: record.body.slice(0, 300),
        })),
      );
    },
  });

  const runJob = defineTool({
    name: "run_job",
    label: "Run job",
    description:
      "Start a detached shell command for long or important executions. The workspace is committed first; the job keeps running if the server restarts, and a message with the outcome, metrics and log tail arrives in this conversation when it ends.",
    promptSnippet:
      "run_job: start a long-running command as a tracked background job",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command, run with bash" }),
      name: Type.Optional(Type.String({ description: "Short human name" })),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory relative to the laboratory; default is the laboratory root",
        }),
      ),
      experiment_id: Type.Optional(
        Type.String({ description: "Experiment record this job belongs to" }),
      ),
      metrics_path: Type.Optional(
        Type.String({
          description:
            "Where the job writes metrics.json, relative to cwd; default metrics.json",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const job = await jobs.start(lab, {
        command: params.command,
        name: params.name,
        cwd: params.cwd,
        experimentId: params.experiment_id ?? null,
        metricsPath: params.metrics_path,
        campaignId,
      });
      return text({
        started: job.id,
        name: job.name,
        pid: job.pid,
        cwd: job.cwd,
        log: job.logPath,
        commit: job.commitHash,
        note: "You will receive a message here when it finishes. Use list_jobs or read the log to check progress.",
      });
    },
  });

  const listJobs = defineTool({
    name: "list_jobs",
    label: "List jobs",
    description:
      "List background jobs of this laboratory with status, exit code and metrics.",
    promptSnippet: "list_jobs: list background jobs and their status",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.Literal("running"),
          Type.Literal("succeeded"),
          Type.Literal("failed"),
          Type.Literal("stopped"),
        ]),
      ),
    }),
    execute: async (_id, params) =>
      text(
        jobs
          .list(lab.id, params.status)
          .filter((job) => !campaignId || job.campaignId === campaignId)
          .slice(0, 50)
          .map((job) => ({
            id: job.id,
            name: job.name,
            status: job.status,
            command: job.command,
            cwd: job.cwd,
            exitCode: job.exitCode,
            metrics: job.metrics,
            log: job.logPath,
            startedAt: job.startedAt,
            endedAt: job.endedAt,
          })),
      ),
  });

  const stopJob = defineTool({
    name: "stop_job",
    label: "Stop job",
    description: "Stop a running background job.",
    promptSnippet: "stop_job: stop a running background job",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (_id, params) => {
      if (campaignId && jobs.get(lab.id, params.id).campaignId !== campaignId)
        throw badRequest("This job belongs to another coordinator");
      const job = await jobs.stop(lab.id, params.id, { notify: false });
      return text({ stopped: job.id, status: job.status });
    },
  });

  const paper = defineTool({
    name: "save_paper",
    label: "Save paper",
    description:
      "Download a source (PDF or web page) by URL or DOI into papers/, extract its text to papers/<id>.md and record it as a paper. Read the .md afterwards for the full text.",
    promptSnippet: "save_paper: download and record a paper or web source",
    parameters: Type.Object({
      url: Type.Optional(Type.String()),
      doi: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      notes: Type.Optional(
        Type.String({ description: "Why this source matters" }),
      ),
    }),
    execute: async (_id, params) => {
      const saved = await savePaper(lab, records, params, author);
      return text({
        saved: saved.record.id,
        title: saved.record.title,
        file: saved.file,
        text: saved.text,
        chars: saved.chars,
        pages: saved.pages,
        warning: saved.warning,
      });
    },
  });

  const dataset = defineTool({
    name: "register_dataset",
    label: "Register dataset",
    description:
      "Record a dataset: a folder or file in the laboratory, or a URL downloaded into data/<name>/. Computes a manifest with sizes and hashes.",
    promptSnippet:
      "register_dataset: record a data folder or download a dataset URL",
    parameters: Type.Object({
      name: Type.String(),
      path: Type.Optional(
        Type.String({
          description: "Folder or file, relative to the laboratory or absolute",
        }),
      ),
      url: Type.Optional(
        Type.String({ description: "URL to download into data/<name>/" }),
      ),
      source: Type.Optional(Type.String()),
      license: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const record = await registerDataset(lab, records, params, author);
      return text({ saved: record.id, title: record.title, ...record.fields });
    },
  });

  const tools: ToolDefinition[] = [
    saveRecord,
    readRecords,
    runJob,
    listJobs,
    stopJob,
    paper,
    dataset,
  ];
  tools.push(
    defineTool({
      name: "save_page",
      label: "Save research page",
      description:
        "Create or update an explanatory research page using Markdown, record references and artifacts. Reuse the existing id for the same topic. Set placement=panorama for the overview, or null to remove that placement. Omitted fields are preserved; blocks replaces the full ordered list. Main explanation belongs in Markdown blocks; body is an alternative summary. A page reads like an essay: a lead of two to four sentences, sections of one claim each in sentence case, claim then evidence then figure, at most three records per records block, figures with a caption that says what to see and what limits it, limits as a blockquote starting with 'Limite:' or 'Nota:'. This saves content without acknowledging an editorial review; use review_pages separately, which also returns form warnings.",
      parameters: Type.Object({
        id: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        placement: Type.Optional(
          Type.Union([Type.Literal("panorama"), Type.Null()]),
        ),
        blocks: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Object({
                type: Type.Literal("markdown"),
                text: Type.String(),
              }),
              Type.Object({
                type: Type.Literal("records"),
                ids: Type.Array(Type.String()),
              }),
              Type.Object({
                type: Type.Literal("artifact"),
                path: Type.String(),
                caption: Type.Optional(Type.String()),
              }),
            ]),
          ),
        ),
        links: Type.Optional(Type.Array(linkSchema)),
        reason: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const page = records.savePage(lab.id, params, author);
        if (editorial && editorialRunId)
          editorial.observe(lab, editorialRunId, page);
        return text({
          saved: page.id,
          kind: page.kind,
          revision: page.revision,
        });
      },
    }),
  );
  if (resources)
    tools.push(
      defineTool({
        name: "read_skill",
        label: "Read research skill",
        description:
          "List the database skill catalog or read one skill's instructions by id. Set examples=true to also load its supporting examples. Examples are illustrative, not laboratory evidence.",
        parameters: Type.Object({
          id: Type.Optional(Type.String()),
          examples: Type.Optional(Type.Boolean()),
        }),
        execute: async (_id, params) => {
          if (!params.id)
            return text(
              (skillCatalog ?? resources.skills()).map(
                ({ id, name, description }) => ({
                  id,
                  name,
                  description,
                }),
              ),
            );
          const found = skillCatalog
            ? skillCatalog.find((skill) => skill.id === params.id)
            : resources.skill(params.id);
          if (!found) throw badRequest(`Skill ${params.id} not found`);
          const { examples, ...skill } = found;
          return text(params.examples ? { ...skill, examples } : skill);
        },
      }),
    );
  if (labs)
    tools.push(
      defineTool({
        name: "lab_context",
        label: "Laboratory context",
        description:
          "Read the laboratory's current direction and standing decisions stored as Markdown in SQLite. Pass content to replace the document, preserving other relevant decisions after reading it. Every update is recorded with its author and revision. This is the active laboratory context, imported once from any existing PICO.md.",
        parameters: Type.Object({ content: Type.Optional(Type.String()) }),
        execute: async (_id, params) =>
          text(
            params.content === undefined
              ? labs.context(lab.id)
              : labs.saveContext(lab.id, params.content, author),
          ),
      }),
    );
  if (editorial && (editorialRunId || subagents))
    tools.push(
      defineTool({
        name: "review_pages",
        label: "Review research pages",
        description:
          "Read editorial coverage: new or changed research records, page revisions, missing references, changed files and unresolved issues. The editor may pass pages to record what it actually reviewed, including pages needing no text change. Supply each page's latest observed revision and a short summary; pending lists unresolved issues. Acknowledgments do not edit pages or certify scientific correctness. Later research changes stay pending. Other agents use this tool read-only.",
        parameters: Type.Object({
          pages: Type.Optional(
            Type.Array(
              Type.Object({
                id: Type.String(),
                revision: Type.Number(),
                summary: Type.String(),
                pending: Type.Optional(Type.Array(Type.String())),
              }),
            ),
          ),
        }),
        execute: async (_id, params) => {
          if (!params.pages) return text(editorial.status(lab));
          if (!editorialRunId)
            throw badRequest(
              "Delegate the review to research-editor; the coordinator reads coverage without acknowledging pages",
            );
          return text(editorial.review(lab, editorialRunId, params.pages));
        },
      }),
    );
  if (subagents && catalog)
    tools.push(
      defineTool({
        name: "list_agents",
        label: "Agent catalog",
        description:
          "Read the fixed global agent catalog: roles, when to use each, and configured models. Agent models are selected by the researcher in Settings → Agents.",
        parameters: Type.Object({}),
        execute: async () =>
          text(
            catalog
              .list()
              .filter(
                (agent) =>
                  !campaignId ||
                  (agent.id !== "campaign-coordinator" &&
                    agent.id !== "research-editor"),
              ),
          ),
      }),
      defineTool({
        name: "run_subagent",
        label: "Run subagent",
        description:
          "Spawn an ephemeral instance of a catalog agent for a self-contained task. Include context, relevant paths and expected output. It uses its configured model and shares the lab workspace and records. Multiple instances of the same agent can run in parallel. Returns immediately; the outcome is delivered here automatically. Do not poll in a loop.",
        parameters: Type.Object({
          agent_id: Type.String(),
          task: Type.String(),
          label: Type.Optional(
            Type.String({
              description:
                "Short scope shown to the researcher next to the agent name, up to 30 characters, e.g. 'sections 1-2'. Give every parallel instance a distinct label.",
            }),
          ),
        }),
        execute: async (_id, params) =>
          text(
            subagents.start(
              lab,
              params.agent_id,
              params.task,
              campaignId,
              params.label ?? null,
            ),
          ),
      }),
      defineTool({
        name: "list_subagents",
        label: "Read subagent runs",
        description:
          "List this laboratory's agent runs and results, including history. Pass id for a run and its conversation (50 messages by default); use before to read earlier messages.",
        parameters: Type.Object({
          id: Type.Optional(Type.String()),
          active: Type.Optional(Type.Boolean()),
          before: Type.Optional(Type.Number()),
          limit: Type.Optional(Type.Number()),
        }),
        execute: async (_id, params) => {
          if (
            params.id &&
            campaignId &&
            subagents.get(lab.id, params.id).campaignId !== campaignId
          )
            throw badRequest("This agent belongs to another coordinator");
          return text(
            params.id
              ? subagents.detail(lab.id, params.id, {
                  before: params.before,
                  limit: params.limit,
                })
              : subagents
                  .list(lab.id, params.active)
                  .filter(
                    (run) => !campaignId || run.campaignId === campaignId,
                  ),
          );
        },
      }),
      defineTool({
        name: "stop_subagent",
        label: "Stop subagent",
        description:
          "Interrupt an agent instance by run id. Files and records already written remain; detached jobs continue and can be stopped separately with stop_job.",
        parameters: Type.Object({ id: Type.String() }),
        execute: async (_id, params) => {
          if (
            campaignId &&
            subagents.get(lab.id, params.id).campaignId !== campaignId
          )
            throw badRequest("This agent belongs to another coordinator");
          return text(await subagents.stop(lab.id, params.id));
        },
      }),
    );
  if (campaigns && campaignCoordinator && campaignId)
    tools.push(
      defineTool({
        name: "campaign_progress",
        label: "Campaign progress",
        description:
          "Update this campaign's plan, current activity and meaningful milestone summary for Pico. Choose continue for another working turn, wait for outstanding agents/jobs, wait_for_pico for an editorial or coordination handoff described in summary, needs_input for a researcher decision, or complete with the deliverable in result. Name affected records/pages in editorial requests. Only the researcher can add budget or resume paused/pending work.",
        parameters: Type.Object({
          plan: Type.Optional(Type.String()),
          activity: Type.Optional(Type.String()),
          summary: Type.Optional(Type.String()),
          result: Type.Optional(Type.String()),
          action: Type.Optional(
            Type.Union([
              Type.Literal("continue"),
              Type.Literal("wait"),
              Type.Literal("wait_for_pico"),
              Type.Literal("needs_input"),
              Type.Literal("complete"),
            ]),
          ),
        }),
        execute: async (_id, params) =>
          text(campaigns.progress(lab.id, campaignId, params)),
      }),
    );
  if (campaigns && !campaignId && subagents)
    tools.push(
      defineTool({
        name: "message_campaign",
        label: "Guide campaign",
        description:
          "Append durable context to an existing campaign: direction, findings from another campaign or the shared Research Editor's page ids and pending issues. Active or waiting campaigns read the update on their next turn. Paused and pending campaigns preserve the update without resuming or changing limits. Reply to campaigns waiting for Pico after reconciling their requests.",
        parameters: Type.Object({ id: Type.String(), message: Type.String() }),
        execute: async (_id, params) =>
          text(campaigns.message(lab.id, params.id, params.message)),
      }),
      defineTool({
        name: "start_campaign",
        label: "Start campaign",
        description:
          "Start an autonomous research campaign with its own persistent coordinator and specialist workers. Define a bounded objective, deliverable and self-contained context. Uses the researcher's default budget and parallelism limits; returns immediately. Milestones and pending decisions arrive in this laboratory chat. Do not poll in loops.",
        parameters: Type.Object({
          title: Type.String(),
          objective: Type.String(),
          deliverable: Type.String(),
          context: Type.Optional(Type.String()),
        }),
        execute: async (_id, params) => text(campaigns.start(lab, params)),
      }),
      defineTool({
        name: "list_campaigns",
        label: "Read campaigns",
        description:
          "Read this laboratory's campaigns, plans, results and limits. Pass id for details and the coordinator's conversation, agents and jobs. Researcher controls are available in campaign details in the sidebar.",
        parameters: Type.Object({
          id: Type.Optional(Type.String()),
          active: Type.Optional(Type.Boolean()),
          before: Type.Optional(Type.Number()),
        }),
        execute: async (_id, params) =>
          text(
            params.id
              ? campaigns.detail(lab.id, params.id, { before: params.before })
              : campaigns.list(lab.id, params.active),
          ),
      }),
    );
  return tools;
}
