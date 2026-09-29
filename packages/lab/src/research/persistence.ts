import type { ConversationRepository } from "@/lab/storage/conversation-repository";
import type { OperationRepository } from "@/lab/storage/operation-repository";
import type { ResearchFiles } from "@/lab/storage/research-files";
import type { ResearchRepository } from "@/lab/storage/research-repository";

/** Research owns notebook content and initial identity, never turn/message transitions. */
export type NotebookPersistence = Pick<
  ConversationRepository,
  | "getConversation"
  | "createConversation"
  | "listMessages"
  | "listTurns"
  | "activeTurn"
  | "modelUsage"
  | "updateSummary"
>;
export interface LaboratoryPersistence {
  research: ResearchRepository;
  conversation: NotebookPersistence;
  operations: Pick<OperationRepository, "mutate">;
}
export type EffectReceipts = Pick<
  OperationRepository,
  "mutate" | "insertEffect" | "getEffect" | "saveEffect"
>;
export interface DatasetPersistence {
  research: Pick<ResearchRepository, "get" | "datasetVersion">;
  files: Pick<
    ResearchFiles,
    | "registerDataset"
    | "importDatasetDirectory"
    | "verifyDataset"
    | "getDataset"
    | "readDatasetFile"
  >;
}
export interface ExecutionPersistence {
  research: Pick<ResearchRepository, "get" | "activeRuns" | "datasetVersion">;
  operations: EffectReceipts & Pick<OperationRepository, "pendingEffects">;
  files: ResearchFiles;
}
