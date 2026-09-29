import type {
  Actor,
  Conclusion,
  DatasetVersion,
  Experiment,
  Hypothesis,
  JsonObject,
  Lab,
  LabEvent,
  Paper,
  Question,
  Result,
  Revision,
  Run,
} from "@/lab/contracts";
import type { Records } from "@/lab/storage/records";
export type ResearchRecord =
  | Question
  | Hypothesis
  | Experiment
  | DatasetVersion
  | Paper
  | Run
  | Result
  | Conclusion;
export type ScientificKind =
  | "question"
  | "hypothesis"
  | "experiment"
  | "dataset"
  | "paper"
  | "run"
  | "result"
  | "conclusion";
type ResearchKind = ScientificKind | "lab" | "event";
/** Access limited to research records; conversation and receipts have other owners. */
export class ResearchRepository {
  constructor(private readonly records: Records) {}
  get<T = ResearchRecord>(kind: ResearchKind, id: string): T | undefined {
    return this.records.get<T>(kind, id);
  }
  list<T = ResearchRecord>(kind: ResearchKind, labId?: string): T[] {
    return this.records.list<T>(kind, labId);
  }
  insert<T extends { id: string }>(
    kind: ResearchKind,
    labId: string,
    value: T,
  ): T {
    return this.records.insert(kind, labId, value);
  }
  replace<T extends { id: string }>(
    kind: ResearchKind,
    labId: string,
    value: T,
  ): T {
    return this.records.replace(kind, labId, value);
  }
  revise<T extends { id: string }>(
    kind: ResearchKind,
    labId: string,
    value: T,
    revision: { author: Actor; reason: string },
  ): T {
    return this.records.revise(kind, labId, value, revision);
  }
  revisions<T = JsonObject>(
    id: string,
  ): (Omit<Revision, "snapshot"> & { snapshot: T })[] {
    return this.records.revisions<T>(id);
  }
  runsForExperiment(labId: string, id: string): Run[] {
    return this.records.query(
      "run",
      labId,
      "json_extract(data, '$.experimentId') = ?",
      [id],
    );
  }
  resultsForExperiment(labId: string, id: string): Result[] {
    return this.records.query(
      "result",
      labId,
      "json_extract(data, '$.experimentId') = ?",
      [id],
    );
  }
  activeRuns(labId?: string): Run[] {
    return this.records.query(
      "run",
      labId,
      "json_extract(data, '$.status') IN ('queued','running')",
    );
  }
  datasetVersion(
    labId: string,
    name: string,
    version: string,
  ): DatasetVersion | undefined {
    return this.records.query<DatasetVersion>(
      "dataset",
      labId,
      "json_extract(data, '$.name') = ? AND json_extract(data, '$.version') = ?",
      [name, version],
      1,
    )[0];
  }
  labs(): Lab[] {
    return this.records.list("lab");
  }
  events(labId: string, limit = 100): LabEvent[] {
    return this.records.query("event", labId, "1", [], limit);
  }
}
