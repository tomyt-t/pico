/** Types shared by the server and the web UI. This module has no runtime dependencies. */

export const recordKinds = [
  "question",
  "hypothesis",
  "experiment",
  "result",
  "conclusion",
  "note",
  "paper",
  "dataset",
  "page",
] as const;
export type RecordKind = (typeof recordKinds)[number];

/** Supported page content; persisted fields remain open to other values. */
export type PageBlock =
  | { type: "markdown"; text: string }
  | { type: "records"; ids: string[] }
  | { type: "artifact"; path: string; caption?: string };

export type PageFields = {
  placement?: "panorama";
  blocks?: PageBlock[];
};

/** Mechanical review coverage, not a judgment of scientific correctness. */
export interface PageReviewStatus {
  pageId: string;
  title: string;
  revision: number;
  reviewedAt: string | null;
  state: "unreviewed" | "pending" | "reviewed";
  summary: string;
  pending: string[];
  changedRecords: string[];
  changedFiles: string[];
  missingRecords: string[];
  missingFiles: string[];
  invalidBlocks: number[];
  /** Reading-shape warnings for the editor to fix; never about the science. */
  shape: string[];
  contentChanged: boolean;
  contextChanged: boolean;
}

export interface EditorialStatus {
  needsReview: boolean;
  panoramaMissing: boolean;
  pages: PageReviewStatus[];
  changes: {
    id: string;
    title: string;
    kind: string;
    revision: number | null;
  }[];
  activeRunId: string | null;
  lastRun: { id: string; status: AgentRunStatus; error: string | null } | null;
}

export interface ReviewPageInput {
  id: string;
  revision: number;
  summary: string;
  pending?: string[];
}

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];

export interface Lab {
  /** Slug of the name; also the workspace folder name. */
  id: string;
  name: string;
  path: string;
  researchLine: string;
  provider: string | null;
  model: string | null;
  thinking: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabInput {
  name: string;
  researchLine?: string;
  provider?: string | null;
  model?: string | null;
  thinking?: string;
}

export type LabPatch = Partial<CreateLabInput>;

export interface LabContext {
  content: string;
  revision: number;
  updatedAt: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  examples: string;
  updatedAt: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
}

export interface SavePageInput {
  id?: string;
  title?: string;
  body?: string;
  placement?: "panorama" | null;
  blocks?: PageBlock[];
  links?: RecordLink[];
  reason?: string;
}

export interface RecordLink {
  kind: string;
  id: string;
}

export interface ResearchRecord {
  id: string;
  labId: string;
  kind: RecordKind;
  title: string;
  status: string | null;
  body: string;
  fields: Record<string, unknown>;
  links: RecordLink[];
  author: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRecordInput {
  id?: string;
  kind: RecordKind;
  title?: string;
  status?: string | null;
  body?: string;
  fields?: Record<string, unknown>;
  links?: RecordLink[];
  reason?: string;
}

export interface RecordRevision {
  revision: number;
  snapshot: ResearchRecord;
  author: string;
  reason: string | null;
  createdAt: string;
}

/** An existing record's creation or transition to its next revision. */
export type RecordHistoryEntry = {
  recordId: string;
  at: string;
  author: string;
  reason: string | null;
} & (
  | { type: "created"; before: null; after: ResearchRecord }
  | { type: "revised"; before: ResearchRecord; after: ResearchRecord }
);

export interface RecordFilter {
  kind?: string;
  status?: string;
  limit?: number;
}

export type JobStatus = "running" | "succeeded" | "failed" | "stopped";

/** Fixed global profiles with database-backed instructions and primary skills. */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  instructions: string;
  skillId: string | null;
  provider: string | null;
  model: string | null;
  thinking: ThinkingLevel;
  updatedAt: string;
}

export interface AgentModelInput {
  provider: string;
  model: string;
  thinking: ThinkingLevel;
}

export type AgentDefinitionPatch = Partial<AgentModelInput> & {
  name?: string;
  description?: string;
  whenToUse?: string;
  instructions?: string;
  skillId?: string;
};

export type AgentRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export interface AgentRun {
  id: string;
  labId: string;
  campaignId: string | null;
  agentId: string;
  name: string;
  task: string;
  /** A short scope given by whoever delegated, telling parallel instances apart. */
  label: string | null;
  status: AgentRunStatus;
  provider: string;
  model: string;
  thinking: string;
  result: string;
  error: string | null;
  /** Claude Code session of this run, readable after it ends. */
  sessionId: string | null;
  currentTool: string | null;
  streamingText: string;
  usage: { total: number; cost: number };
  notified: boolean;
  createdAt: string;
  endedAt: string | null;
}

export interface AgentRunDetail extends ChatMessagePage {
  run: AgentRun;
}

export interface CampaignSettings {
  budgetUsd: number;
  maxAgents: number;
  labMaxAgents: number;
}

export type CampaignStatus =
  | "active"
  | "waiting"
  | "pending"
  | "paused"
  | "completed"
  | "ended";
export interface CreateCampaignInput {
  title: string;
  objective: string;
  deliverable: string;
  context?: string;
}

export interface Campaign extends CreateCampaignInput {
  id: string;
  labId: string;
  context: string;
  plan: string;
  activity: string;
  summary: string;
  result: string;
  status: CampaignStatus;
  reason:
    | "budget"
    | "capacity"
    | "results"
    | "pico"
    | "input"
    | "error"
    | "researcher"
    | "rate_limit"
    | null;
  /** Limit on estimated consumption at API prices; a plan is not charged per use. */
  budgetUsd: number;
  maxAgents: number;
  usage: { total: number; cost: number };
  provider: string;
  model: string;
  thinking: string;
  /** The coordinator's persistent Claude Code session. */
  sessionId: string | null;
  /** When the Claude plan limit that stopped the campaign resets, if known. */
  limitResetsAt: string | null;
  currentTool: string | null;
  isWorking: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface CampaignProgressInput {
  plan?: string;
  activity?: string;
  summary?: string;
  result?: string;
  action?: "continue" | "wait" | "wait_for_pico" | "needs_input" | "complete";
}

export type CampaignControl =
  | { action: "pause" }
  | {
      action: "resume";
      addBudgetUsd?: number;
      maxAgents?: number;
      message?: string;
    }
  | { action: "end"; jobs?: "keep" | "stop" };

export interface CampaignDetail extends ChatMessagePage {
  campaign: Campaign;
  agents: AgentRun[];
  jobs: Job[];
}

export interface Metric {
  name: string;
  value: number;
  unit?: string;
  split?: string;
  step?: number;
}

export interface Job {
  id: string;
  labId: string;
  campaignId: string | null;
  name: string;
  command: string;
  cwd: string;
  status: JobStatus;
  pid: number | null;
  commitHash: string | null;
  logPath: string;
  metricsPath: string;
  metrics: Metric[] | null;
  exitCode: number | null;
  error: string | null;
  experimentId: string | null;
  notified: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
}

export interface SessionState {
  labId: string;
  streaming: boolean;
  model: { provider: string; id: string; name: string } | null;
  thinking: string;
  queue: { steering: string[]; followUp: string[] };
  lastError: string | null;
  sessionId: string | null;
  streamingText: string;
}

export type SessionEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean }
  | { type: "message_end" }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "compaction"; phase: "start" | "end" }
  | { type: "retry"; attempt: number; message: string }
  | { type: "error"; message: string }
  | { type: "state"; state: SessionState };

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; arguments: unknown }[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  kind?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input: number; output: number; total: number; cost: number };
  timestamp: number;
}

export interface ChatMessagePage {
  messages: UiMessage[];
  before: number | null;
  usage: { total: number; cost: number };
}

export interface ChatView extends ChatMessagePage {
  state: SessionState;
}

export interface FileEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string | null;
}

export type FileView =
  | { kind: "directory"; path: string; entries: FileEntry[] }
  | {
      kind: "file";
      path: string;
      size: number;
      modifiedAt: string;
      binary: boolean;
      truncated: boolean;
      content: string | null;
    };

export interface JobDetail {
  job: Job;
  log: string;
}

export interface RecordDetailView {
  record: ResearchRecord;
  revisions: RecordRevision[];
}
