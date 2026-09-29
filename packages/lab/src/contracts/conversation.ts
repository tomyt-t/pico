import type { Json, JsonObject } from "@/lab/contracts/json";

export interface Conversation {
  id: string;
  labId: string;
  summary: string;
  summaryThroughMessageId: string | null;
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
}
