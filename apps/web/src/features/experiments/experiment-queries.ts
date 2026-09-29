import type { ExperimentDetail, LabOverview } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
export function useExperimentsOverview(labId: string) {
  return usePoll<LabOverview>(labPath(labId, "/overview"), 1500);
}
export function useExperimentDetail(labId: string, experimentId: string) {
  return usePoll<ExperimentDetail>(
    labPath(labId, `/experiments/${encodeURIComponent(experimentId)}`),
    1500,
  );
}
export function useWorkspaceFiles(labId: string, experimentId: string) {
  return usePoll<{ files: { path: string; size: number }[] }>(
    labPath(labId, `/experiments/${encodeURIComponent(experimentId)}/files`),
    5000,
  );
}
export function useWorkspaceFile(
  labId: string,
  experimentId: string,
  path: string,
) {
  return usePoll<{ path: string; content: string; clipped: boolean }>(
    path
      ? labPath(
          labId,
          `/experiments/${encodeURIComponent(experimentId)}/file?path=${encodeURIComponent(path)}`,
        )
      : null,
    5000,
  );
}
export function useRunLogs(labId: string, runId: string, stream: string) {
  return usePoll<{ text: string }>(
    labPath(
      labId,
      `/runs/${encodeURIComponent(runId)}/logs?stream=${stream}&tail=200`,
    ),
    1500,
  );
}
