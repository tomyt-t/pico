import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentCatalog } from "./agent-catalog";
import type { AgentResources } from "./agent-resources";
import type { Campaigns } from "./campaigns";
import type { AgentSkill } from "./contracts";
import { registerDataset } from "./datasets";
import type { Editorial } from "./editorial";
import { badRequest, errorMessage } from "./errors";
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

export type PicoTool = SdkMcpToolDefinition;
type Result = Awaited<ReturnType<PicoTool["handler"]>>;

function text(value: unknown): Result {
  return {
    content: [
      {
        type: "text",
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** A tool whose failures reach the model as an error result, not a crash. */
function define<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  run: (params: z.infer<z.ZodObject<Shape>>) => unknown,
): PicoTool {
  return tool(name, description, shape, async (params) => {
    try {
      return text(await run(params as z.infer<z.ZodObject<Shape>>));
    } catch (error) {
      return { ...text(errorMessage(error)), isError: true };
    }
  }) as PicoTool;
}

const kindSchema = z.enum(recordKinds);
const linkSchema = z.object({
  kind: z.string().describe("Kind of the linked record"),
  id: z.string().describe("Id of the linked record"),
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
}: ToolDependencies): PicoTool[] {
  const tools: PicoTool[] = [
    define(
      "save_record",
      "Create or update a structured research record (question, hypothesis, experiment, result, conclusion, note, paper, dataset, page). Pass id to update; omitted fields keep their value and fields are shallow-merged. Links connect records by kind and id. A page presents research using its Markdown body and optional fields.blocks. Set fields.placement='panorama' for the laboratory overview. Updating fields.blocks replaces the entire block list; send all blocks you want to keep.",
      {
        kind: kindSchema,
        id: z.string().describe("Existing record id to update").optional(),
        title: z
          .string()
          .describe("Short title; required when creating")
          .optional(),
        status: z
          .string()
          .describe(
            "Free status, for example open, testing, supported, refuted, inconclusive, draft, done",
          )
          .optional(),
        body: z
          .string()
          .describe("Markdown body with the substance")
          .optional(),
        fields: z
          .record(z.string(), z.any())
          .describe(
            "Free structured fields, for example path, jobId, metrics, confidence. For pages: placement may be 'panorama'; blocks may contain {type:'markdown', text:string}, {type:'records', ids:string[]} or {type:'artifact', path:string, caption?:string}. Artifact paths are relative to the laboratory. Updating blocks replaces the whole list.",
          )
          .optional(),
        links: z.array(linkSchema).optional(),
        reason: z.string().describe("Why the record changed").optional(),
      },
      (params) => {
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
              : params.fields,
            links: params.links,
            reason: params.reason,
          },
          author,
        );
        if (editorial && editorialRunId)
          editorial.observe(lab, editorialRunId, record);
        return {
          saved: record.id,
          kind: record.kind,
          revision: record.revision,
        };
      },
    ),
    define(
      "read_records",
      "List research records of this laboratory, optionally by kind or status, or read one record in full by id. Set history=true for creations and revisions, newest first, with before/after content and the author, date and reason of each change. History respects kind and limit, and ignores id and status; references point to current records, not frozen targets.",
      {
        kind: kindSchema.optional(),
        id: z.string().optional(),
        status: z.string().optional(),
        history: z.boolean().optional(),
        limit: z
          .number()
          .describe(
            "History: default 100, maximum 500. Record lists in this tool: default 100, maximum 5000.",
          )
          .optional(),
      },
      (params) => {
        if (params.history)
          return records.history(lab.id, {
            kind: params.kind,
            limit: params.limit,
          });
        if (params.id) {
          const record = records.get(lab.id, params.id);
          if (editorial && editorialRunId)
            editorial.observe(lab, editorialRunId, record);
          return record;
        }
        return records
          .list(lab.id, {
            kind: params.kind,
            status: params.status,
            limit: params.limit ?? 100,
          })
          .map((record) => ({
            id: record.id,
            kind: record.kind,
            title: record.title,
            status: record.status,
            links: record.links,
            updatedAt: record.updatedAt,
            revision: record.revision,
            summary: record.body.slice(0, 300),
          }));
      },
    ),
    define(
      "run_job",
      "Start a detached shell command for long or important executions. The workspace is committed first; the job keeps running if the server restarts, and a message with the outcome, metrics and log tail arrives in this conversation when it ends.",
      {
        command: z.string().describe("Shell command, run with bash"),
        name: z.string().describe("Short human name").optional(),
        cwd: z
          .string()
          .describe(
            "Working directory relative to the laboratory; default is the laboratory root",
          )
          .optional(),
        experiment_id: z
          .string()
          .describe("Experiment record this job belongs to")
          .optional(),
        metrics_path: z
          .string()
          .describe(
            "Where the job writes metrics.json, relative to cwd; default metrics.json",
          )
          .optional(),
      },
      async (params) => {
        const job = await jobs.start(lab, {
          command: params.command,
          name: params.name,
          cwd: params.cwd,
          experimentId: params.experiment_id ?? null,
          metricsPath: params.metrics_path,
          campaignId,
        });
        return {
          started: job.id,
          name: job.name,
          pid: job.pid,
          cwd: job.cwd,
          log: job.logPath,
          commit: job.commitHash,
          note: "You will receive a message here when it finishes. Use mcp__pico__list_jobs or read the log to check progress.",
        };
      },
    ),
    define(
      "list_jobs",
      "List background jobs of this laboratory with status, exit code and metrics.",
      {
        status: z
          .enum(["running", "succeeded", "failed", "stopped"])
          .optional(),
      },
      (params) =>
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
    define(
      "stop_job",
      "Stop a running background job.",
      { id: z.string() },
      async (params) => {
        if (campaignId && jobs.get(lab.id, params.id).campaignId !== campaignId)
          throw badRequest("This job belongs to another coordinator");
        const job = await jobs.stop(lab.id, params.id, { notify: false });
        return { stopped: job.id, status: job.status };
      },
    ),
    define(
      "save_paper",
      "Download a source (PDF or web page) by URL or DOI into papers/, extract its text to papers/<id>.md and record it as a paper. Read the .md afterwards for the full text.",
      {
        url: z.string().optional(),
        doi: z.string().optional(),
        title: z.string().optional(),
        notes: z.string().describe("Why this source matters").optional(),
      },
      async (params) => {
        const saved = await savePaper(lab, records, params, author);
        return {
          saved: saved.record.id,
          title: saved.record.title,
          file: saved.file,
          text: saved.text,
          chars: saved.chars,
          pages: saved.pages,
          warning: saved.warning,
        };
      },
    ),
    define(
      "register_dataset",
      "Record a dataset: a folder or file in the laboratory, or a URL downloaded into data/<name>/. Computes a manifest with sizes and hashes.",
      {
        name: z.string(),
        path: z
          .string()
          .describe("Folder or file, relative to the laboratory or absolute")
          .optional(),
        url: z
          .string()
          .describe("URL to download into data/<name>/")
          .optional(),
        source: z.string().optional(),
        license: z.string().optional(),
        description: z.string().optional(),
      },
      async (params) => {
        const record = await registerDataset(lab, records, params, author);
        return { saved: record.id, title: record.title, ...record.fields };
      },
    ),
    define(
      "save_page",
      "Create or update an explanatory research page using Markdown, record references and artifacts. Reuse the existing id for the same topic. Set placement=panorama for the overview, or null to remove that placement. Omitted fields are preserved; blocks replaces the full ordered list. Main explanation belongs in Markdown blocks; body is an alternative summary. A page reads like an essay: a lead of two to four sentences, sections of one claim each in sentence case, claim then evidence then figure, at most three records per records block, figures with a caption that says what to see and what limits it, limits as a blockquote starting with 'Limite:' or 'Nota:'. This saves content without acknowledging an editorial review; use mcp__pico__review_pages separately, which also returns form warnings.",
      {
        id: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        placement: z.literal("panorama").nullable().optional(),
        blocks: z
          .array(
            z.union([
              z.object({ type: z.literal("markdown"), text: z.string() }),
              z.object({
                type: z.literal("records"),
                ids: z.array(z.string()),
              }),
              z.object({
                type: z.literal("artifact"),
                path: z.string(),
                caption: z.string().optional(),
              }),
            ]),
          )
          .optional(),
        links: z.array(linkSchema).optional(),
        reason: z.string().optional(),
      },
      (params) => {
        const page = records.savePage(lab.id, params, author);
        if (editorial && editorialRunId)
          editorial.observe(lab, editorialRunId, page);
        return { saved: page.id, kind: page.kind, revision: page.revision };
      },
    ),
  ];
  if (resources)
    tools.push(
      define(
        "read_skill",
        "List the database skill catalog or read one skill's instructions by id. Set examples=true to also load its supporting examples. Examples are illustrative, not laboratory evidence.",
        { id: z.string().optional(), examples: z.boolean().optional() },
        (params) => {
          if (!params.id)
            return (skillCatalog ?? resources.skills()).map(
              ({ id, name, description }) => ({ id, name, description }),
            );
          const found = skillCatalog
            ? skillCatalog.find((skill) => skill.id === params.id)
            : resources.skill(params.id);
          if (!found) throw badRequest(`Skill ${params.id} not found`);
          const { examples, ...skill } = found;
          return params.examples ? { ...skill, examples } : skill;
        },
      ),
    );
  if (labs)
    tools.push(
      define(
        "lab_context",
        "Read the laboratory's current direction and standing decisions stored as Markdown in SQLite. Pass content to replace the document, preserving other relevant decisions after reading it. Every update is recorded with its author and revision. This is the active laboratory context, imported once from any existing PICO.md.",
        { content: z.string().optional() },
        (params) =>
          params.content === undefined
            ? labs.context(lab.id)
            : labs.saveContext(lab.id, params.content, author),
      ),
    );
  if (editorial && (editorialRunId || subagents))
    tools.push(
      define(
        "review_pages",
        "Read editorial coverage: new or changed research records, page revisions, missing references, changed files and unresolved issues. The editor may pass pages to record what it actually reviewed, including pages needing no text change. Supply each page's latest observed revision and a short summary; pending lists unresolved issues. Acknowledgments do not edit pages or certify scientific correctness. Later research changes stay pending. Other agents use this tool read-only.",
        {
          pages: z
            .array(
              z.object({
                id: z.string(),
                revision: z.number(),
                summary: z.string(),
                pending: z.array(z.string()).optional(),
              }),
            )
            .optional(),
        },
        (params) => {
          if (!params.pages) return editorial.status(lab);
          if (!editorialRunId)
            throw badRequest(
              "Delegate the review to research-editor; the coordinator reads coverage without acknowledging pages",
            );
          return editorial.review(lab, editorialRunId, params.pages);
        },
      ),
    );
  if (subagents && catalog)
    tools.push(
      define(
        "list_agents",
        "Read the fixed global agent catalog: roles, when to use each, and configured models. Agent models are selected by the researcher in Settings → Agents.",
        {},
        () =>
          catalog
            .list()
            .filter(
              (agent) =>
                !campaignId ||
                (agent.id !== "campaign-coordinator" &&
                  agent.id !== "research-editor"),
            ),
      ),
      define(
        "run_subagent",
        "Spawn an ephemeral instance of a catalog agent for a self-contained task. Include context, relevant paths and expected output. It uses its configured model and shares the lab workspace and records. Multiple instances of the same agent can run in parallel. Returns immediately; the outcome is delivered here automatically. Do not poll in a loop.",
        {
          agent_id: z.string(),
          task: z.string(),
          label: z
            .string()
            .describe(
              "Short scope shown to the researcher next to the agent name, up to 30 characters, e.g. 'sections 1-2'. Give every parallel instance a distinct label.",
            )
            .optional(),
        },
        (params) =>
          subagents.start(
            lab,
            params.agent_id,
            params.task,
            campaignId,
            params.label ?? null,
          ),
      ),
      define(
        "list_subagents",
        "List this laboratory's agent runs and results, including history. Pass id for a run and its conversation (50 messages by default); use before to read earlier messages.",
        {
          id: z.string().optional(),
          active: z.boolean().optional(),
          before: z.number().optional(),
          limit: z.number().optional(),
        },
        async (params) => {
          if (
            params.id &&
            campaignId &&
            subagents.get(lab.id, params.id).campaignId !== campaignId
          )
            throw badRequest("This agent belongs to another coordinator");
          return params.id
            ? await subagents.detail(lab.id, params.id, {
                before: params.before,
                limit: params.limit,
              })
            : subagents
                .list(lab.id, params.active)
                .filter((run) => !campaignId || run.campaignId === campaignId);
        },
      ),
      define(
        "stop_subagent",
        "Interrupt an agent instance by run id. Files and records already written remain; detached jobs continue and can be stopped separately with mcp__pico__stop_job.",
        { id: z.string() },
        async (params) => {
          if (
            campaignId &&
            subagents.get(lab.id, params.id).campaignId !== campaignId
          )
            throw badRequest("This agent belongs to another coordinator");
          return await subagents.stop(lab.id, params.id);
        },
      ),
      define(
        "resume_subagent",
        "Continue a failed, stopped or interrupted agent run in its saved conversation, e.g. after a Claude plan limit resets or the server restarted. The agent keeps everything it read and wrote; message adds optional guidance. Returns immediately; the outcome is delivered here automatically.",
        { id: z.string(), message: z.string().optional() },
        (params) => {
          if (
            campaignId &&
            subagents.get(lab.id, params.id).campaignId !== campaignId
          )
            throw badRequest("This agent belongs to another coordinator");
          return subagents.resume(lab, params.id, params.message ?? null);
        },
      ),
    );
  if (campaigns && campaignCoordinator && campaignId)
    tools.push(
      define(
        "campaign_progress",
        "Update this campaign's plan, current activity and meaningful milestone summary for Pico. Choose continue for another working turn, wait for outstanding agents/jobs, wait_for_pico for an editorial or coordination handoff described in summary, needs_input for a researcher decision, or complete with the deliverable in result. Name affected records/pages in editorial requests. Only the researcher can add budget or resume paused/pending work.",
        {
          plan: z.string().optional(),
          activity: z.string().optional(),
          summary: z.string().optional(),
          result: z.string().optional(),
          action: z
            .enum([
              "continue",
              "wait",
              "wait_for_pico",
              "needs_input",
              "complete",
            ])
            .optional(),
        },
        (params) => campaigns.progress(lab.id, campaignId, params),
      ),
    );
  if (campaigns && !campaignId && subagents)
    tools.push(
      define(
        "message_campaign",
        "Append durable context to an existing campaign: direction, findings from another campaign or the shared Research Editor's page ids and pending issues. Active or waiting campaigns read the update on their next turn. Paused and pending campaigns preserve the update without resuming or changing limits. Reply to campaigns waiting for Pico after reconciling their requests.",
        { id: z.string(), message: z.string() },
        (params) => campaigns.message(lab.id, params.id, params.message),
      ),
      define(
        "start_campaign",
        "Start an autonomous research campaign with its own persistent coordinator and specialist workers. Define a bounded objective, deliverable and self-contained context. Uses the researcher's default budget and parallelism limits; returns immediately. Milestones and pending decisions arrive in this laboratory chat. Do not poll in loops.",
        {
          title: z.string(),
          objective: z.string(),
          deliverable: z.string(),
          context: z.string().optional(),
        },
        (params) => campaigns.start(lab, params),
      ),
      define(
        "list_campaigns",
        "Read this laboratory's campaigns, plans, results and limits. Pass id for details and the coordinator's conversation, agents and jobs. Researcher controls are available in campaign details in the sidebar.",
        {
          id: z.string().optional(),
          active: z.boolean().optional(),
          before: z.number().optional(),
        },
        async (params) =>
          params.id
            ? await campaigns.detail(lab.id, params.id, {
                before: params.before,
              })
            : campaigns.list(lab.id, params.active),
      ),
    );
  return tools;
}

/** Pico's tools as an in-process MCP server; the model sees mcp__pico__*. */
export function picoMcpServer(
  deps: ToolDependencies,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "pico",
    tools: createPicoTools(deps),
    alwaysLoad: true,
  });
}
