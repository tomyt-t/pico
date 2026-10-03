import type {
  Job,
  JobDetail,
  Lab,
  Metric,
  ResearchRecord,
} from "@pico/server/contracts";
import { useEffect, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import { currentRoute, routePath } from "@/web/app/navigation";
import { FolderGlance } from "@/web/components/folder-glance";
import {
  duration,
  excerpt,
  kindLabel,
  number,
  relativeTime,
  shortTimestamp,
  timestamp,
} from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { JobRow } from "@/web/components/job-row";
import {
  Code,
  Empty,
  Icon,
  Loading,
  Notice,
  Section,
  Status,
} from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import {
  LinkChips,
  RecordPage,
  RecordRow,
  recordHref,
  useBackLink,
} from "@/web/components/record-card";
import { jobsOf, resultsOf } from "@/web/features/experiments/job-links";
import {
  type Front,
  frontLabel,
  frontOf,
  frontsOf,
  frontTimeline,
  leadSentence,
  sourcesOf,
  stateTone,
} from "@/web/features/fronts/fronts";
import { useAuthor } from "@/web/features/records/authors";
import { useRecords } from "@/web/features/records/record-queries";

export function MetricsTable({ metrics }: { metrics: Metric[] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const shown = filter
    ? metrics.filter((metric) =>
        `${metric.name} ${metric.split ?? ""}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : metrics;
  const dimensions = {
    unit: metrics.some((metric) => metric.unit !== undefined),
    split: metrics.some((metric) => metric.split !== undefined),
    step: metrics.some((metric) => metric.step !== undefined),
  };
  return (
    <>
      {metrics.length > 12 && (
        <div className="toolbar">
          <input
            type="search"
            placeholder={t("experiments.filterMetrics")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="meta">
            {shown.length} / {metrics.length}
          </span>
        </div>
      )}
      <div className="table-scroll metrics-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("metrics.name")}</th>
              <th className="num">{t("metrics.value")}</th>
              {dimensions.unit && <th>{t("metrics.unit")}</th>}
              {dimensions.split && <th>{t("metrics.split")}</th>}
              {dimensions.step && <th className="num">{t("metrics.step")}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((metric, index) => (
              <tr
                key={`${metric.name}-${metric.split ?? ""}-${metric.step ?? index}`}
              >
                <td className="mono">{metric.name}</td>
                <td className="num">{number(metric.value)}</td>
                {dimensions.unit && <td>{metric.unit ?? ""}</td>}
                {dimensions.split && <td>{metric.split ?? ""}</td>}
                {dimensions.step && (
                  <td className="num">{metric.step ?? ""}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExperimentCard({
  labId,
  experiment,
  results,
  jobs,
}: {
  labId: string;
  experiment: ResearchRecord;
  results: ResearchRecord[];
  jobs: Job[];
}) {
  const { t } = useTranslation();
  const folder =
    typeof experiment.fields.path === "string" ? experiment.fields.path : null;
  const running = jobs.filter((job) => job.status === "running").length;
  return (
    <article className={`experiment-card ${running ? "live" : ""}`}>
      <div className="record-heading">
        <div>
          <h3>
            <a href={recordHref(experiment)}>{experiment.title}</a>
          </h3>
          <div className="record-meta">
            {folder && (
              <a href={routePath({ labId, page: "collection", path: folder })}>
                <Icon name="folder" size={13} /> {folder}
              </a>
            )}
            <time dateTime={experiment.updatedAt}>
              {relativeTime(experiment.updatedAt)}
            </time>
          </div>
        </div>
        {experiment.status && <Status value={experiment.status} />}
      </div>
      {experiment.body && (
        <p className="record-summary">{excerpt(experiment.body, 220)}</p>
      )}
      <div className="experiment-columns">
        <div className="nested">
          <p className="eyebrow">
            {t("experiments.results")}{" "}
            <span className="count">{results.length}</span>
          </p>
          {results.length ? (
            results.map((record) => (
              <RecordRow key={record.id} record={record} />
            ))
          ) : (
            <p className="muted small">{t("experiments.noResultsYet")}</p>
          )}
        </div>
        <div className="nested">
          <p className="eyebrow">
            {t("experiments.jobs")} <span className="count">{jobs.length}</span>
          </p>
          {jobs.length ? (
            jobs
              .slice(0, 6)
              .map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  experiment={experiment}
                  records={results}
                  jobs={jobs}
                />
              ))
          ) : (
            <p className="muted small">{t("experiments.noJobsYet")}</p>
          )}
        </div>
      </div>
    </article>
  );
}

const executionsRoute = (labId: string) =>
  routePath({ labId, page: "collection", tab: "executions" });

function JobPage({ lab, id }: { lab: Lab; id: string }) {
  const { t } = useTranslation();
  const detail = usePoll<JobDetail>(
    labPath(lab.id, `/jobs/${encodeURIComponent(id)}`),
    3_000,
  );
  const records = useRecords(lab.id);
  const stop = useAction();
  const back = useBackLink({
    label: t("collection.executions"),
    href: executionsRoute(lab.id),
  });
  const log = useRef<HTMLPreElement>(null);
  const job = detail.data?.job;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The log grows while the job runs.
  useEffect(() => {
    if (log.current && job?.status === "running")
      log.current.scrollTop = log.current.scrollHeight;
  }, [detail.data?.log]);
  const inside = (absolute: string) =>
    absolute.startsWith(`${lab.path}/`)
      ? absolute.slice(lab.path.length + 1)
      : null;
  const runFolder = job
    ? inside(job.metricsPath.replace(/\/[^/]+$/, ""))
    : null;
  /** The named experiment, when it exists; the model sometimes names one before creating it. */
  const experiment = job?.experimentId
    ? records.data?.find((record) => record.id === job.experimentId)
    : undefined;
  return (
    <div className="page">
      <a className="back" href={back.href}>
        ← {back.label}
      </a>
      {detail.loading && !job && <Loading>{t("common.loading")}</Loading>}
      {detail.error && detail.status !== 404 && (
        <Notice error>{detail.error}</Notice>
      )}
      {!detail.loading && !job && (detail.status === 404 || !detail.error) && (
        <Notice error>{t("experiments.job.notFound", { id })}</Notice>
      )}
      {job && (
        <div className="stack">
          <article className="panel">
            <div className="record-heading">
              <div>
                <p className="eyebrow">
                  {t("experiments.job.title")} ·{" "}
                  <span className="id-chip">{job.id}</span>
                </p>
                <h1>{job.name}</h1>
              </div>
              <div className="actions">
                <Status value={job.status} />
                {job.status === "running" && (
                  <button
                    type="button"
                    className="small stop-button"
                    disabled={stop.busy}
                    onClick={async () => {
                      if (
                        await stop.run(
                          labPath(
                            lab.id,
                            `/jobs/${encodeURIComponent(id)}/stop`,
                          ),
                        )
                      )
                        detail.refresh();
                    }}
                  >
                    <Icon name="stop" size={13} />
                    {stop.busy
                      ? t("experiments.job.stopping")
                      : t("experiments.job.stop")}
                  </button>
                )}
              </div>
            </div>
            {stop.error && <Notice error>{stop.error}</Notice>}
            {job.error && <Notice error>{job.error}</Notice>}
            <dl className="details-grid job-details">
              <div>
                <dt>{t("experiments.job.started")}</dt>
                <dd>{timestamp(job.startedAt)}</dd>
              </div>
              <div>
                <dt>{t("experiments.job.duration")}</dt>
                <dd>{duration(job.startedAt, job.endedAt)}</dd>
              </div>
              <div>
                <dt>{t("experiments.job.exitCode")}</dt>
                <dd>{job.exitCode ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("experiments.job.cwd")}</dt>
                <dd className="mono">{inside(job.cwd) ?? job.cwd}</dd>
              </div>
              <div>
                <dt>{t("experiments.job.commit")}</dt>
                <dd className="mono">{job.commitHash?.slice(0, 12) ?? "—"}</dd>
              </div>
              {job.experimentId && (
                <div>
                  <dt>{t("experiments.job.experiment")}</dt>
                  <dd>
                    {experiment ? (
                      <a className="pill-link" href={recordHref(experiment)}>
                        {experiment.title}
                      </a>
                    ) : records.data ? (
                      <span
                        className="pill-link missing"
                        title={t("experiments.job.experimentMissing")}
                      >
                        {job.experimentId}
                      </span>
                    ) : (
                      <span className="mono">{job.experimentId}</span>
                    )}
                  </dd>
                </div>
              )}
              {runFolder && (
                <div>
                  <dt>{t("experiments.runFolder")}</dt>
                  <dd>
                    <a
                      href={routePath({
                        labId: lab.id,
                        page: "collection",
                        path: runFolder,
                      })}
                    >
                      {runFolder}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <details className="protocol">
              <summary>{t("experiments.job.command")}</summary>
              <Code language="shellscript" wrap>
                {job.command}
              </Code>
            </details>
          </article>
          <Section
            title={t("experiments.job.metrics")}
            count={job.metrics?.length}
          >
            {job.metrics?.length ? (
              <MetricsTable metrics={job.metrics} />
            ) : (
              <p className="muted">{t("experiments.job.noMetrics")}</p>
            )}
          </Section>
          <Section title={t("experiments.job.log")}>
            <p className="meta" style={{ marginBottom: 12 }}>
              {t("experiments.job.logHint", { path: job.logPath })}
            </p>
            <pre className="code log" ref={log}>
              {detail.data?.log || " "}
            </pre>
          </Section>
        </div>
      )}
    </div>
  );
}

/** Running jobs, one card per experiment, then results and jobs without one. */
export function ExecutionsList({ lab }: { lab: Lab }) {
  const { t } = useTranslation();
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  const all = records.data ?? [];
  const allJobs = jobs.data ?? [];
  const experiments = all
    .filter((record) => record.kind === "experiment")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const results = all.filter((record) => record.kind === "result");
  const claimedJobs = new Set(
    experiments.flatMap((experiment) =>
      jobsOf(experiment, allJobs).map((job) => job.id),
    ),
  );
  const claimedResults = new Set(
    experiments.flatMap((experiment) =>
      resultsOf(experiment, results).map((result) => result.id),
    ),
  );
  const looseJobs = allJobs.filter((job) => !claimedJobs.has(job.id));
  const looseResults = results.filter(
    (result) => !claimedResults.has(result.id),
  );
  const running = allJobs.filter((job) => job.status === "running");
  return (
    <QueryState
      loading={records.loading && !records.data}
      error={records.error ?? jobs.error}
      hasData={!!records.data}
      refresh={() => {
        records.refresh();
        jobs.refresh();
      }}
    >
      <div className="stack">
        {running.length > 0 && (
          <Section title={t("collection.running")} count={running.length}>
            {running.map((job) => (
              <JobRow key={job.id} job={job} records={all} jobs={allJobs} />
            ))}
          </Section>
        )}
        {experiments.length === 0 ? (
          <section className="panel">
            <Empty title={t("experiments.noExperiments")} />
          </section>
        ) : (
          experiments.map((experiment) => (
            <ExperimentCard
              key={experiment.id}
              labId={lab.id}
              experiment={experiment}
              results={resultsOf(experiment, results)}
              jobs={jobsOf(experiment, allJobs)}
            />
          ))
        )}
        {looseResults.length > 0 && (
          <Section
            title={t("experiments.looseResults")}
            count={looseResults.length}
          >
            {looseResults.map((record) => (
              <RecordRow key={record.id} record={record} />
            ))}
          </Section>
        )}
        {looseJobs.length > 0 && (
          <Section title={t("experiments.looseJobs")} count={looseJobs.length}>
            {looseJobs.map((job) => (
              <JobRow key={job.id} job={job} records={all} jobs={allJobs} />
            ))}
          </Section>
        )}
      </div>
    </QueryState>
  );
}

/** Detail of a job, an experiment or a result. The list is the collection's
 *  executions tab (`ExecutionsList`). */
export function ExperimentsPage({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
}) {
  if (id.startsWith("job-")) return <JobPage lab={lab} id={id} />;
  return <ExperimentRecord lab={lab} id={id} discuss={discuss} />;
}

function ExperimentRecord({
  lab,
  id,
  discuss,
}: {
  lab: Lab;
  id: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const author = useAuthor();
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  const all = records.data ?? [];
  const allJobs = jobs.data ?? [];
  const fronts = frontsOf(all, allJobs);
  const front = fronts.find((item) => item.experiment.id === id);
  const current = all.find((record) => record.id === id);
  const parent =
    current && current.kind !== "experiment"
      ? frontOf(current, fronts)
      : undefined;
  const from = currentRoute();
  const finding = front?.finding;
  const findingText = finding ? excerpt(finding.body, 600) : "";
  const [lead, rest] = findingText ? leadSentence(findingText) : ["", ""];
  return (
    <RecordPage
      labId={lab.id}
      id={id}
      all={all}
      discuss={discuss}
      back={{
        label: t("fronts.title"),
        href: routePath({ labId: lab.id, page: "investigations" }),
      }}
      eyebrow={
        front ? (
          <p className="eyebrow front-eyebrow">
            {frontLabel(front.experiment)} ·{" "}
            <span className="id-chip">{id}</span>
            <span className={`chip ${stateTone[front.state]}`}>
              {t(`fronts.state.${front.state}`)}
            </span>
          </p>
        ) : undefined
      }
      links={!front}
      beforeContent={
        front ? (
          <section className="front-finding-block">
            <p className="eyebrow">{t("fronts.finding")}</p>
            {finding ? (
              <>
                <p>
                  {lead && <b>{lead}</b>}
                  {lead && rest ? " " : ""}
                  {rest}
                </p>
                <a className="text-button" href={recordHref(finding, from)}>
                  {kindLabel(finding.kind)} · {finding.title}
                </a>
              </>
            ) : (
              <p className="muted">{t("fronts.noFinding")}</p>
            )}
          </section>
        ) : undefined
      }
    >
      {(record) =>
        front && record.kind === "experiment" ? (
          <FrontSections
            lab={lab}
            front={front}
            records={all}
            jobs={allJobs}
            from={from}
            author={author}
          />
        ) : parent ? (
          <p className="meta front-parent">
            {t("fronts.belongsTo")}:{" "}
            <a href={recordHref(parent.experiment, from)}>
              {parent.experiment.title}
            </a>
          </p>
        ) : null
      }
    </RecordPage>
  );
}

/** What a front holds beyond its protocol: materials, executions with context,
 *  other links, and the side cards (timeline, files, sources). */
function FrontSections({
  lab,
  front,
  records,
  jobs,
  from,
  author,
}: {
  lab: Lab;
  front: Front;
  records: ResearchRecord[];
  jobs: Job[];
  from?: string;
  author: (author: string) => string;
}) {
  const { t } = useTranslation();
  const materials = [...front.conclusions, ...front.results];
  const sources = sourcesOf(front, records);
  const covered = new Set([
    ...materials.map((record) => record.id),
    ...front.jobs.map((job) => job.id),
    ...sources.map((source) => source.id),
  ]);
  const titles = new Map(records.map((record) => [record.id, record.title]));
  const others = front.experiment.links
    .filter((link) => !covered.has(link.id))
    .map((link) => ({ ...link, title: titles.get(link.id) }));
  const referencedBy = records
    .filter(
      (record) =>
        record.id !== front.experiment.id &&
        !covered.has(record.id) &&
        record.links.some((link) => link.id === front.experiment.id),
    )
    .map((record) => ({
      kind: record.kind,
      id: record.id,
      title: record.title,
    }));
  const folder =
    typeof front.experiment.fields.path === "string"
      ? front.experiment.fields.path
      : null;
  return (
    <div className="front-sections">
      <section>
        <p className="eyebrow">
          {t("fronts.materials")}{" "}
          <span className="count">{materials.length}</span>
        </p>
        {materials.length ? (
          materials.map((record) => (
            <RecordRow key={record.id} record={record} from={from} />
          ))
        ) : (
          <p className="muted small">{t("fronts.noFinding")}</p>
        )}
      </section>
      <section>
        <p className="eyebrow">
          {t("fronts.executions")}{" "}
          <span className="count">{front.jobs.length}</span>
        </p>
        {front.jobs.length ? (
          front.jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              experiment={front.experiment}
              records={records}
              jobs={jobs}
              from={from}
            />
          ))
        ) : (
          <p className="muted small">{t("fronts.noExecutions")}</p>
        )}
      </section>
      {(others.length > 0 || referencedBy.length > 0) && (
        <section>
          <p className="eyebrow">{t("fronts.links")}</p>
          <LinkChips labId={lab.id} links={[...others, ...referencedBy]} />
        </section>
      )}
      <div className="front-aside">
        <div className="front-aside-card">
          <h3>{t("fronts.timeline")}</h3>
          <ol className="front-timeline">
            {frontTimeline(front, author, from).map((step) => (
              <li key={`${step.at}:${step.text}`}>
                <time dateTime={step.at} title={timestamp(step.at)}>
                  {shortTimestamp(step.at)}
                </time>
                {step.href ? (
                  <a href={step.href}>{step.text}</a>
                ) : (
                  <span>{step.text}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
        {folder && (
          <FolderGlance
            labId={lab.id}
            folder={folder}
            title={t("fronts.files")}
          />
        )}
        <div className="front-aside-card">
          <h3>{t("fronts.sources")}</h3>
          {sources.length ? (
            <LinkChips labId={lab.id} links={sources} />
          ) : (
            <p className="muted small">{t("fronts.noSources")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
