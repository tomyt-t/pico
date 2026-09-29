import type { FileDigest, FileInput } from "@/runner/files";
/** Historical v1 provenance. These are wire fields, never scientific rules. */
export type Actor = { kind: "researcher" | "pico" | "system"; turnId?: string };
export interface Criterion {
  hypothesisId: string;
  hypothesisRevision?: number;
  metric: string;
  expectation: string;
  comparator?: "gt" | "gte" | "lt" | "lte" | "eq";
  threshold?: number;
  split?: string;
  unit?: string;
  step?: number;
}

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";
export interface Metric {
  name: string;
  value: number;
  unit?: string;
  split?: string;
  step?: number;
}
export interface DatasetManifest {
  schemaVersion: 1;
  labId: string;
  id: string;
  name: string;
  source: string;
  license: string;
  createdAt: string;
  files: FileDigest[];
  version?: string;
  description?: string;
  splits?: Record<string, number>;
  author?: Actor;
  sha256: string;
}
export interface RunRequest {
  runId: string;
  labId: string;
  experimentId: string;
  protocol: string;
  experimentRevision?: number;
  criteria?: Criterion[];
  config: Record<string, unknown>;
  datasetIds?: string[];
  entrypoint: string;
  args?: string[];
  /** null runs without a deadline; cancellation and interruption still stop it. */
  timeoutMs: number | null;
  runtime?: "python" | "uv";
  referenceRunId?: string;
  resources?: { memoryMiB?: number; gpuDevices?: string[] };
}
export interface SnapshotManifest {
  schemaVersion: 1;
  createdAt: string;
  request: RunRequest;
  code: FileDigest[];
  datasets: DatasetManifest[];
  sha256: string;
  environment: {
    platform: string;
    arch: string;
    runtime: "python" | "uv";
    runtimeVersion: string;
  };
}
export interface RunRecord {
  schemaVersion: 1;
  id: string;
  labId: string;
  experimentId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string;
  workerPid?: number;
  heartbeatAt?: string;
  snapshotHash: string;
  metrics: Metric[];
  artifacts: FileDigest[];
  command: string[];
  runtimeVersion?: string;
  logsTruncated?: boolean;
}
export interface RunBundle {
  schemaVersion: 1;
  record: RunRecord;
  snapshot: SnapshotManifest;
  files: FileInput[];
}
export function terminal(status: RunStatus): boolean {
  return status !== "queued" && status !== "running";
}

export type DatasetManifestV1 = DatasetManifest;
export interface SnapshotSources {
  workspaceDir: string;
  datasets: { manifest: DatasetManifest; filesDir: string }[];
}
export interface ExecutionInspection {
  record: RunRecord;
  state: "queued" | "active" | "terminal" | "unknown";
  reason?: string;
}
export interface ExecutionInventory {
  runs: ExecutionInspection[];
  issues: ExecutionIssue[];
  recoveredPublications: string[];
  pendingPublications: string[];
  pendingDeliveries: string[];
  safeToBackup: boolean;
}
export interface ExecutionIssue {
  labId: string;
  runId?: string;
  directory: string;
  kind:
    | "unreadable_record"
    | "unreadable_snapshot"
    | "unsafe_publication"
    | "observation_delivery";
  reason: string;
}
