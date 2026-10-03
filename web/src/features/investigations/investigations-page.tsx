import { type Job, type Lab, recordKinds } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, routePath } from "@/web/app/navigation";
import { kindLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import { Empty, Loading } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { LinkChips, RecordPage, RecordRow } from "@/web/components/record-card";
import { experimentOf } from "@/web/features/experiments/job-links";
import {
  type Investigation,
  questionMaterials,
} from "@/web/features/investigations/investigation-links";
import { useRecords } from "@/web/features/records/record-queries";

function InvestigationMaterials({
  investigation,
  jobsLoaded,
}: {
  investigation: Investigation;
  jobsLoaded: boolean;
}) {
  const { t } = useTranslation();
  const from = currentRoute();
  const missingLinks = investigation.missingLinks.filter(
    (link) =>
      jobsLoaded || (link.kind !== "job" && !link.id.startsWith("job-")),
  );
  return (
    <div className="investigation-materials">
      <div className="section-heading">
        <h2>{t("investigations.materials")}</h2>
      </div>
      <p className="muted small">{t("investigations.connections")}</p>
      {investigation.records.length ? (
        recordKinds.map((kind) => {
          const items = investigation.records.filter(
            (record) => record.kind === kind,
          );
          if (!items.length) return null;
          return (
            <section className="investigation-group" key={kind}>
              <h3>
                {kindLabel(kind, true)}{" "}
                <span className="count">{items.length}</span>
              </h3>
              {items.map((record) => (
                <RecordRow record={record} key={record.id} from={from} />
              ))}
            </section>
          );
        })
      ) : (
        <Empty title={t("investigations.noMaterials")} />
      )}
      {missingLinks.length > 0 && (
        <section className="investigation-group">
          <h3>{t("investigations.missing")}</h3>
          <LinkChips
            labId={investigation.question.labId}
            links={missingLinks}
            known={new Set<string>()}
          />
        </section>
      )}
      <section className="investigation-group">
        <h3>{t("investigations.jobs")}</h3>
        <p className="muted small">{t("investigations.jobsHint")}</p>
        {investigation.jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            experiment={experimentOf(job, investigation.records)}
            records={investigation.records}
            jobs={investigation.jobs}
            from={from}
          />
        ))}
        {jobsLoaded && !investigation.jobs.length && (
          <p className="muted small">{t("investigations.noJobs")}</p>
        )}
      </section>
    </div>
  );
}

/** A question with everything explicitly linked to it, in either direction. */
export function QuestionPage({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  const all = records.data ?? [];
  return (
    <QueryState
      loading={false}
      error={records.error}
      hasData={!!records.data}
      refresh={records.refresh}
    >
      <RecordPage
        labId={lab.id}
        id={id}
        all={all}
        discuss={discuss}
        back={{
          label: t("fronts.title"),
          href: routePath({ labId: lab.id, page: "investigations" }),
        }}
      >
        {(record) =>
          record.kind === "question" ? (
            <>
              <QueryState
                loading={jobs.loading && !jobs.data}
                error={jobs.error}
                hasData={!!jobs.data}
                refresh={jobs.refresh}
              >
                {null}
              </QueryState>
              {records.loading && !records.data && (
                <Loading>{t("common.loadingRecords")}</Loading>
              )}
              {records.data && (
                <InvestigationMaterials
                  investigation={questionMaterials(
                    record,
                    all,
                    jobs.data ?? [],
                  )}
                  jobsLoaded={!!jobs.data}
                />
              )}
            </>
          ) : null
        }
      </RecordPage>
    </QueryState>
  );
}
