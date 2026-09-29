import type { Json, JsonObject } from "@/lab/contracts/json";

export interface Conversation {
  id: string;
  labId: string;
  summary: string;
  summaryThroughMessageId: string | null;
  /** Extractive checkpoint; originals and provider transcripts remain preserved. */
  compaction?: {
    throughMessageId: string;
    summary: string;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type TurnStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface Turn {
  id: string;
  labId: string;
  conversationId: string;
  status: TurnStatus;
  trigger: "researcher" | "run_completed";
  message: string;
  eventId: string | null;
  steps: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  usage?: ModelUsage;
  /** Persisted recovery budget; continuing an overflow never resends the same context. */
  contextBudgetBytes?: number;
  /** The minimum context also overflowed; changing provider/model clears this guard. */
  contextBlockedFor?: string;
  eventIds?: string[];
  eventRuns?: { eventId: string; runId: string }[];
}

export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  tokensKnown: boolean;
  costKnown: boolean;
}

export interface ToolCallView {
  id: string;
  name: string;
  arguments: JsonObject;
  status: "running" | "completed" | "failed";
  result?: Json;
  error?: string;
}

export interface Message {
  /** System-origin observation; role remains user when sent to the model. */
  eventId?: string;
  eventRunId?: string;
  /** Link to the server-only native model transcript; never contains provider payloads. */
  modelStepId?: string;
  id: string;
  labId: string;
  conversationId: string;
  turnId: string | null;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: ToolCallView;
  createdAt: string;
}

export interface LabEvent {
  id: string;
  labId: string;
  kind: string;
  entityType: string;
  entityId: string;
  message: string;
  createdAt: string;
  payload: JsonObject;
  consumedAt: string | null;
}

export interface ConversationView {
  conversation: Conversation;
  messages: Message[];
  turns: Turn[];
  activeTurn: Turn | null;
  usage?: ModelUsage;
  history?: { hasMore: boolean; before: string | null };
  resumableTurns?: Turn[];
}
