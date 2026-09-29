/** Browser-safe public data contracts. Never re-export runtime modules. */

export type {
  Conversation,
  ConversationView,
  LabEvent,
  Message,
  ToolCallView,
  Turn,
  TurnStatus,
} from "@/lab/contracts/conversation";
export type {
  Artifact,
  Criterion,
  DatasetInput,
  Experiment,
  Metric,
  NewExperiment,
  Run,
  RunRequest,
  RunSnapshot,
  RunStatus,
} from "@/lab/contracts/experiments";
export {
  artifactSchema,
  criterionSchema,
  experimentSchema,
  metricSchema,
  runSchema,
  runSnapshotSchema,
} from "@/lab/contracts/experiments";
export type { ApiError } from "@/lab/contracts/http";
export type { Json, JsonObject } from "@/lab/contracts/json";
export type { CreateLabInput, Lab, LabSettings } from "@/lab/contracts/labs";
export { labSchema, settingsSchema } from "@/lab/contracts/labs";
export type {
  DatasetRegistration,
  DatasetVersion,
  FileContentInput,
  FileManifest,
  NewDataset,
  NewPaper,
  Paper,
} from "@/lab/contracts/library";
export {
  datasetSchema,
  fileSchema,
  paperSchema,
} from "@/lab/contracts/library";
export type {
  PiCatalog,
  PiModelOption,
  PiProviderOption,
  ProviderConfig,
  ProviderStatus,
} from "@/lab/contracts/models";
export type {
  Actor,
  MutationContext,
  RecordMeta,
  Revision,
} from "@/lab/contracts/record-metadata";
export { actorSchema } from "@/lab/contracts/record-metadata";
export type {
  Conclusion,
  Hypothesis,
  HypothesisStatus,
  NewConclusion,
  NewHypothesis,
  NewQuestion,
  NewResult,
  ObservationReference,
  Question,
  QuestionStatus,
  Result,
  ResultPatch,
} from "@/lab/contracts/research";
export {
  conclusionSchema,
  hypothesisSchema,
  observationReferenceSchema,
  questionSchema,
  resultPatchSchema,
  resultSchema,
} from "@/lab/contracts/research";
export type { WebToolName } from "@/lab/contracts/sources";
export { webSchemas, webToolNames } from "@/lab/contracts/sources";
export { patchSchema } from "@/lab/contracts/validation";
export type {
  ExperimentDetail,
  LabOverview,
  LabStatus,
} from "@/lab/contracts/views";
