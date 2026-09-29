import type { RecordMeta, Run } from "@/lab/contracts";
export type NewRun = Pick<Run, "experimentId"> &
  Partial<Omit<Run, keyof RecordMeta | "experimentId" | "attempt">> & {
    id?: string;
  };
export type RunPatch = Partial<
  Pick<
    Run,
    | "status"
    | "command"
    | "startedAt"
    | "endedAt"
    | "exitCode"
    | "error"
    | "metrics"
    | "artifacts"
    | "snapshot"
  >
>;

export const terminal = new Set<Run["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);
