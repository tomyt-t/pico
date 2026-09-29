/** Compile the public contract surface without Node, Bun, React or provider SDK globals. */

import type {
  ConversationView,
  ExperimentDetail,
  LabOverview,
  LabStatus,
  PiCatalog,
  ProviderStatus,
  RunSnapshot,
} from "@pico/lab/contracts";
import * as contracts from "@pico/lab/contracts";

export const validation = [
  contracts.labSchema,
  contracts.experimentSchema,
  contracts.runSnapshotSchema,
  contracts.resultSchema,
  contracts.webSchemas,
];
export type BrowserPayload =
  | ConversationView
  | ExperimentDetail
  | LabOverview
  | LabStatus
  | PiCatalog
  | ProviderStatus
  | RunSnapshot;

export function serialize(payload: BrowserPayload): string {
  return JSON.stringify(payload);
}
