import type { JsonObject, ProviderConfig } from "@/lab/contracts";

export interface ModelTool {
  name: string;
  description: string;
  parameters: JsonObject;
}
export interface ModelCall {
  id: string;
  name: string;
  arguments: JsonObject;
}
/** Only the matching provider adapter interprets this durable envelope. */
export interface NativeTranscript {
  format: "pi";
  version: 1;
  payload: JsonObject;
}
export interface ModelReply {
  content: string;
  calls: ModelCall[];
  usage?: JsonObject;
  native?: NativeTranscript;
  error?: string;
}
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  tool_name?: string;
  isError?: boolean;
  timestamp?: number;
  images?: { data: string; mimeType: string }[];
  native?: NativeTranscript;
}
export type ModelAdapter = (input: {
  config: ProviderConfig;
  messages: ModelMessage[];
  tools: ModelTool[];
  signal: AbortSignal;
  sessionId?: string;
}) => Promise<ModelReply>;

export interface ModelStep {
  id: string;
  labId: string;
  turnId: string;
  step: number;
  provider: ProviderConfig;
  usage: JsonObject | null;
  /** The adapter also reads legacy bare native payloads without rewriting them. */
  native?: NativeTranscript | JsonObject;
  replayable?: boolean;
  createdAt: string;
}

export interface ModelAccess {
  complete: ModelAdapter;
  catalog(): Promise<import("@/lab/contracts").PiCatalog>;
  status(
    config: ProviderConfig,
  ): Promise<import("@/lab/contracts").ProviderStatus>;
  test?(
    config: ProviderConfig,
  ): Promise<import("@/lab/contracts").ProviderStatus>;
  close(): Promise<void>;
  releaseSession?(sessionId: string): void;
}
