import type { Result, Run } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { routePath } from "@/web/app/navigation";
import { useTranslation } from "@/web/components/i18n";
import { Hash } from "@/web/components/record-text";

export function ResultEvidence({
  result,
  runs,
}: {
  result: Result;
  runs: Run[];
}) {
  const { t } = useTranslation();
  if (!result.evidence?.length) return null;
  return (
    <ul className="link-list">
      {result.evidence.map((reference) => (
        <li key={JSON.stringify(reference)}>
          <a
            href={routePath({
              labId: result.labId,
              page: "experiments",
              id: result.experimentId,
              tab: "runs",
              focus: `run-${reference.runId}`,
            })}
          >
            {t("common.attempt", {
              attempt:
                runs.find((run) => run.id === reference.runId)?.attempt ?? "?",
            })}
            {reference.kind === "metric" && (
              <>
                {" "}
                · {reference.name} = {reference.value} {reference.unit ?? ""}
                {reference.split ? ` · ${reference.split}` : ""}
                {reference.step !== null ? ` · step ${reference.step}` : ""}
              </>
            )}
          </a>
          {reference.kind === "artifact" && (
            <>
              {" "}
              ·{" "}
              <a
                href={`/api${labPath(result.labId, `/runs/${reference.runId}/artifact?path=${encodeURIComponent(reference.path)}`)}`}
                download={reference.path.split("/").at(-1)}
              >
                {reference.path}
              </a>{" "}
              <Hash value={reference.sha256} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
