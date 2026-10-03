import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import {
  picoContent,
  picoSections,
  useLabContext,
} from "@/web/app/laboratory-queries";
import { routePath } from "@/web/app/navigation";
import { excerpt, kindLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import { Markdown } from "@/web/components/markdown";
import { Empty, Notice, Section, Status } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { RecordRow } from "@/web/components/record-card";
import { experimentOf } from "@/web/features/experiments/job-links";
import {
  getInvestigations,
  relevantJobs,
} from "@/web/features/investigations/investigation-links";
import { useRecords } from "@/web/features/records/record-queries";

/** The kinds counted in the collection tiles, in display order. */
const collectionKinds = [
  "paper",
  "dataset",
  "experiment",
  "result",
  "note",
] as const;
const latestConclusions = 5;
const endedExecutions = 3;
const evidencePerFront = 2;

const newestFirst = (a: ResearchRecord, b: ResearchRecord) =>
  b.updatedAt.localeCompare(a.updatedAt);

/** Before any page exists: what the Panorama is for and how to start it. */
export function PanoramaEmpty({
  lab,
  discuss,
}: {
  lab: Lab;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="panel panorama-empty">
      <Empty title={t("pages.emptyPanorama")}>
        {t("pages.emptyPanoramaBody")}
      </Empty>
      <button type="button" onClick={() => discuss(t("pages.panoramaRequest"))}>
        {t("pages.planPanorama")}
      </button>
      <a href={routePath({ labId: lab.id, page: "evolution" })}>
        {t("pages.followEvolution")}
      </a>
    </div>
  );
}

/** The questions still open, each with its latest conclusions and results. */
export function openFronts(records: ResearchRecord[], jobs: Job[]) {
  const { investigations } = getInvestigations(records, jobs);
  return investigations
    .filter((investigation) => investigation.question.status === "open")
    .map(({ question, records: related }) => ({
      question,
      materials: related.length,
      evidence: related
        .filter(
          (record) => record.kind === "conclusion" || record.kind === "result",
        )
        .sort(newestFirst)
        .slice(0, evidencePerFront),
    }));
}

/** A Panorama composed from what the laboratory already holds. Pure: the
 *  wrapper below fetches; tests render this with fixtures. */
export function AutoPanorama({
  lab,
  records,
  jobs,
  pico,
  discuss,
}: {
  lab: Lab;
  records: ResearchRecord[];
  jobs: Job[];
  /** The text of laboratory context, or empty when it is not available. */
  pico: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { researchLine, direction } = picoSections(pico);
  const lead = excerpt(researchLine, 240);
  if (!records.length && !jobs.length && !lead && !direction)
    return <PanoramaEmpty lab={lab} discuss={discuss} />;
  const fronts = openFronts(records, jobs);
  const conclusions = records
    .filter((record) => record.kind === "conclusion")
    .sort(newestFirst)
    .slice(0, latestConclusions);
  const running = jobs.filter((job) => job.status === "running").length;
  const executions = relevantJobs(jobs, running + endedExecutions);
  const link = (page: "investigations" | "experiments", id?: string) =>
    routePath({ labId: lab.id, page, ...(id && { id }) });
  return (
    <div className="stack auto-panorama">
      <Notice>
        {t("pages.autoNotice")}{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => discuss(t("pages.panoramaRequest"))}
        >
          {t("pages.planPanorama")}
        </button>
      </Notice>
      {(lead || direction) && (
        <section className="panel panorama-direction">
          {lead && <p className="panorama-lead">{lead}</p>}
          {direction && (
            <>
              <p className="eyebrow">{t("pages.direction")}</p>
              <Markdown>{direction}</Markdown>
            </>
          )}
        </section>
      )}
      {fronts.length > 0 && (
        <Section
          title={t("pages.openFronts")}
          count={fronts.length}
          action={
            <a href={link("investigations")}>{t("activity.allQuestions")}</a>
          }
        >
          <div className="panorama-fronts">
            {fronts.map(({ question, materials, evidence }) => (
              <article key={question.id} className="panorama-front">
                <div className="record-heading">
                  <h3>
                    <a href={link("investigations", question.id)}>
                      {question.title}
                    </a>
                  </h3>
                  {question.status && <Status value={question.status} />}
                </div>
                <p className="meta">
                  {t("activity.related", { count: materials })}
                </p>
                {evidence.map((record) => (
                  <RecordRow key={record.id} record={record} />
                ))}
              </article>
            ))}
          </div>
        </Section>
      )}
      {(conclusions.length > 0 || executions.length > 0) && (
        <div className="grid-two">
          {conclusions.length > 0 && (
            <Section
              title={t("pages.latestConclusions")}
              count={conclusions.length}
              action={
                <a
                  href={routePath({
                    labId: lab.id,
                    page: "collection",
                    kind: "conclusion",
                  })}
                >
                  {t("pages.viewAll")}
                </a>
              }
            >
              {conclusions.map((record) => (
                <RecordRow key={record.id} record={record} />
              ))}
            </Section>
          )}
          {executions.length > 0 && (
            <Section
              title={t("pages.executions")}
              count={jobs.length}
              action={<a href={link("experiments")}>{t("activity.allJobs")}</a>}
            >
              <div className="panorama-jobs">
                {executions.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    experiment={experimentOf(job, records)}
                    records={records}
                    jobs={jobs}
                  />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
      {records.length > 0 && (
        <Section title={t("shell.pages.collection")}>
          <div className="stats">
            {collectionKinds.map((kind) => (
              <a
                key={kind}
                className="stat"
                href={routePath({ labId: lab.id, page: "collection", kind })}
              >
                <strong>
                  {records.filter((record) => record.kind === kind).length}
                </strong>
                <span>{kindLabel(kind, true)}</span>
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Fetches records, executions and laboratory context for the composed Panorama. */
export function ComposedPanorama({
  lab,
  discuss,
}: {
  lab: Lab;
  discuss: (text: string) => void;
}) {
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  const pico = useLabContext(lab.id);
  return (
    <QueryState
      loading={records.loading && !records.data}
      error={records.error}
      hasData={!!records.data}
      refresh={records.refresh}
    >
      {records.data && (
        <AutoPanorama
          lab={lab}
          records={records.data}
          jobs={jobs.data ?? []}
          pico={picoContent(pico.data)}
          discuss={discuss}
        />
      )}
    </QueryState>
  );
}
