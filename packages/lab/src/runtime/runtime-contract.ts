import type {
  ExecutionStatus,
  MutationContext,
  PiCatalog,
  ProviderStatus,
  Turn,
} from "@/lab/contracts";
import type { ModelAccess, ModelAdapter } from "@/lab/models/model-contract";
import type { Research } from "@/lab/research/laboratory";
import type { SourceAccess } from "@/lab/sources/source-access";

export interface LabRuntimeOptions {
  dataDir: string;
  piAgentDir?: string;
  model?: ModelAdapter;
  models?: ModelAccess;
  sources?: SourceAccess;
}
export interface LabRuntime {
  readonly research: Research;
  readonly conversation: {
    enqueue(labId: string, message: string, context: MutationContext): Turn;
    stop(labId: string, id: string, context: MutationContext): Turn;
    continue(labId: string, id: string, context: MutationContext): Turn;
    getTurn(labId: string, id: string): Turn;
  };
  readonly models: {
    catalog(): Promise<PiCatalog>;
    status(labId: string): Promise<ProviderStatus>;
    test(labId: string): Promise<ProviderStatus>;
  };
  readonly administration: {
    executionStatus(labId: string): Promise<ExecutionStatus>;
    repairExecution(
      labId: string,
      runId: string,
      context: MutationContext,
    ): Promise<{ state: string; reason?: string }>;
    cleanupWork(
      labId: string,
      runId: string,
      context: MutationContext,
    ): Promise<{ removed: boolean }>;
    backup(
      destination: string,
      context: MutationContext,
    ): Promise<{ path: string }>;
  };
  readonly state: "constructed" | "starting" | "active" | "closing" | "closed";
  /** Keeps a previously admitted operation alive while shutdown drains its work. */
  withOperation<T>(operation: () => T): T;
  start(): Promise<void>;
  /** Call outside withOperation; closing inside admitted work rejects with CONFLICT. */
  close(): Promise<void>;
}
