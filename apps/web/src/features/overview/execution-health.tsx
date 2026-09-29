import type { ExecutionStatus } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { usePoll } from "@/web/api/use-poll";
import { routePath } from "@/web/app/navigation";
import { useTranslation } from "@/web/components/i18n";
import { Notice, Section } from "@/web/components/primitives";

export function ExecutionHealth({ labId }: { labId: string }) {
  const { t } = useTranslation();
  const status = usePoll<ExecutionStatus>(labPath(labId, "/execution"), 5000);
  const action = useMutation();
  const data = status.data;
  const uncertain = data?.runs.filter((run) => run.state === "unknown") ?? [];
  if (!status.error && !data?.blocked && !data?.recoveredPublications.length)
    return null;
  const entries = [
    ...(data?.issues.map((issue) => ({
      id: issue.directory,
      runId: issue.runId,
      reason: issue.reason,
    })) ?? []),
    ...uncertain.map((run) => ({
      id: run.runId,
      runId: run.runId,
      reason: run.reason,
    })),
  ];
  return (
    <Section title={t("operations.title")}>
      {status.error && <Notice error>{status.error}</Notice>}
      {data?.blocked && <Notice error>{t("operations.blocked")}</Notice>}
      {data?.otherBlockedLabs.map((lab) => (
        <p key={lab.labId}>
          <a href={routePath({ labId: lab.labId, page: "overview" })}>
            {lab.name}
          </a>
        </p>
      ))}
      {entries.map((entry) => (
        <div className="record" key={entry.id}>
          <p className="mono">{entry.runId ?? entry.id}</p>
          <p>{entry.reason}</p>
          {entry.runId && (
            <button
              type="button"
              disabled={action.busy}
              onClick={async () => {
                await action.mutate(
                  labPath(labId, `/execution/${entry.runId}/repair`),
                );
                status.refresh();
              }}
            >
              {t("operations.reconcile")}
            </button>
          )}
        </div>
      ))}
      {!!data?.recoveredPublications.length && (
        <p>
          {t("operations.preserved", {
            count: data.recoveredPublications.length,
          })}
        </p>
      )}
      {action.error && <Notice error>{action.error}</Notice>}
    </Section>
  );
}
