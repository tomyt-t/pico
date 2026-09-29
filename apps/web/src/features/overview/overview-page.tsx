import type { LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { author, statusLabel, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import {
  Empty,
  Icon,
  PageHeading,
  Section,
  Status,
} from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { IdText } from "@/web/components/record-text";
import { ConclusionRecord } from "@/web/features/overview/conclusion-detail";
import { ExecutionHealth } from "@/web/features/overview/execution-health";
import { useOverviewOverview } from "@/web/features/overview/overview-queries";
import { QuestionRecord } from "@/web/features/overview/question-detail";
import { questionRecords } from "@/web/features/overview/question-records";
import { ResultLinks } from "@/web/features/overview/result-links";

export function Overview({
  overview,
  questionId,
  discuss,
}: {
  overview: LabOverview;
  questionId?: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { lab } = overview;
  const needsReview = [...overview.hypotheses, ...overview.conclusions].filter(
    (record) => record.needsReview,
  );
  const activeRuns = overview.runs.filter((entry) =>
    ["queued", "running"].includes(entry.status),
  );
  const latestRuns = overview.experiments
    .filter((entry) => entry.status !== "archived")
    .flatMap((experiment) =>
      overview.runs
        .filter((run) => run.experimentId === experiment.id)
        .sort((a, b) => b.attempt - a.attempt)
        .slice(0, 1),
    );
  const failures = latestRuns.filter((run) =>
    ["failed", "timed_out", "interrupted"].includes(run.status),
  );
  if (questionId) {
    const question = overview.questions.find(
      (entry) => entry.id === questionId,
    );
    if (!question)
      return (
        <div className="page">
          <a
            className="back"
            href={routePath({ labId: lab.id, page: "overview" })}
          >
            {t("overview.back")}
          </a>
          <Empty title={t("overview.questionNotFound")}>
            {t("overview.questionNotFoundBody")}
          </Empty>
        </div>
      );
    const records = questionRecords(overview, question.id);
    return (
      <div className="page">
        <a
          className="back"
          href={routePath({ labId: lab.id, page: "overview" })}
        >
          {t("overview.back")}
        </a>
        <PageHeading
          eyebrow={t("overview.researchQuestion")}
          title={question.text}
          action={
            <button
              className="primary"
              type="button"
              onClick={() =>
                discuss(
                  t("overview.reviewQuestionPrompt", {
                    id: question.id,
                    text: question.text,
                  }),
                )
              }
            >
              <Icon name="chat" size={15} />
              {t("common.discussWithPico")}
            </button>
          }
        >
          {question.context}
        </PageHeading>
        <div className="chip-row" style={{ marginBottom: 24 }}>
          <Status value={question.status} />
          <span className="meta">
            {t("overview.revisionUpdated", {
              revision: question.revision,
              date: timestamp(question.updatedAt),
            })}
          </span>
        </div>
        <div className="grid-main">
          <div className="stack">
            <Section title={t("overview.hypotheses")}>
              {records.hypotheses.length ? (
                records.hypotheses.map((row) => (
                  <article
                    key={row.id}
                    className="record"
                    id={`hypothesis-${row.id}`}
                  >
                    <div className="record-heading">
                      <h3>{row.statement}</h3>
                      <Status value={row.status} />
                    </div>
                    {row.needsReview && (
                      <span className="status status-paused">
                        {t("common.needsReview")}
                      </span>
                    )}
                    <p>{row.rationale}</p>
                    {row.assessment && (
                      <p>
                        <strong>{t("overview.assessment")}</strong>{" "}
                        {row.assessment}
                      </p>
                    )}
                    <div className="record-meta">
                      <span>
                        {t("overview.revision", { revision: row.revision })}
                      </span>
                      <span>
                        {t("common.by", { author: author(row.author.kind) })}
                      </span>
                    </div>
                    <div className="link-list">
                      <ResultLinks row={row} overview={overview} />
                    </div>
                  </article>
                ))
              ) : (
                <Empty title={t("overview.noHypotheses")}>
                  {t("overview.noHypothesesBody")}
                </Empty>
              )}
            </Section>
            <Section title={t("overview.experiments")}>
              {records.experiments.length ? (
                records.experiments.map((row) => (
                  <article className="record" key={row.id}>
                    <div className="record-heading">
                      <h3>
                        <a
                          href={routePath({
                            labId: lab.id,
                            page: "experiments",
                            id: row.id,
                          })}
                        >
                          {row.title}
                        </a>
                      </h3>
                      <Status value={row.status} />
                    </div>
                    <p>{row.objective}</p>
                    <div className="record-meta">
                      <span>
                        {row.hypothesisIds.length
                          ? t("common.hypothesisTest")
                          : t("common.exploratory")}
                      </span>
                      <span>
                        {t("common.runs", {
                          count: overview.runs.filter(
                            (run) => run.experimentId === row.id,
                          ).length,
                        })}
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <Empty title={t("overview.noExperiments")}>
                  {t("overview.noExperimentsBody")}
                </Empty>
              )}
            </Section>
          </div>
          <Section title={t("overview.learned")}>
            {records.conclusions.length ? (
              records.conclusions.map((row) => (
                <ConclusionRecord row={row} overview={overview} key={row.id} />
              ))
            ) : (
              <Empty title={t("overview.noConclusion")}>
                {t("overview.noConclusionBody")}
              </Empty>
            )}
          </Section>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <ExecutionHealth labId={lab.id} />
      {!!overview.resumableTurns?.length && (
        <div className="notice">
          <span>{t("operations.resumable")}</span>{" "}
          <a href={routePath({ labId: lab.id, page: "chat" })}>
            {t("operations.resumeChat")}
          </a>
        </div>
      )}
      <PageHeading
        eyebrow={t("overview.eyebrow")}
        title={t("overview.title")}
        action={
          <button
            className="primary"
            type="button"
            onClick={() => discuss(t("overview.discussPrompt"))}
          >
            <Icon name="chat" size={15} />
            {t("overview.discussNext")}
          </button>
        }
      >
        {t("overview.subtitle")}
      </PageHeading>
      {lab.researchLine && (
        <section
          className="direction"
          aria-label={t("shell.researchDirection")}
        >
          <p className="eyebrow">{t("shell.researchDirection")}</p>
          <p>{lab.researchLine}</p>
        </section>
      )}
      <div className="stats">
        <a
          className="stat"
          href={routePath({ labId: lab.id, page: "overview" })}
          onClick={(event) => {
            event.preventDefault();
            document
              .getElementById("research-questions")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <strong>
            {
              overview.questions.filter((entry) =>
                ["open", "partially_answered"].includes(entry.status),
              ).length
            }
          </strong>
          <span>{t("overview.openQuestions")}</span>
        </a>
        <a
          className="stat"
          href={routePath({ labId: lab.id, page: "experiments" })}
        >
          <strong>{overview.experiments.length}</strong>
          <span>{t("overview.experiments")}</span>
        </a>
        <a
          className={activeRuns.length ? "stat live" : "stat"}
          href={routePath({
            labId: lab.id,
            page: "experiments",
            ...(activeRuns[0] && {
              id: activeRuns[0].experimentId,
              tab: "runs",
            }),
          })}
        >
          <strong>{activeRuns.length}</strong>
          <span>{t("overview.activeRuns")}</span>
        </a>
        <div className="stat">
          <strong>
            {
              overview.conclusions.filter(
                (entry) => entry.status !== "retracted",
              ).length
            }
          </strong>
          <span>{t("overview.standingConclusions")}</span>
        </div>
      </div>
      {(needsReview.length > 0 ||
        failures.length > 0 ||
        overview.activeTurn?.status === "paused" ||
        overview.activeTurn?.error) && (
        <section className="panel" style={{ marginBottom: 22 }}>
          <div className="section-heading">
            <h2>{t("overview.needsAttention")}</h2>
          </div>
          {needsReview.map((record) => (
            <p key={record.id}>
              <span className="status status-paused">
                {t("common.needsReview")}
              </span>{" "}
              <a
                href={routePath({
                  labId: lab.id,
                  page: "overview",
                  id: record.questionId,
                })}
              >
                {record.statement}
              </a>
            </p>
          ))}
          {overview.activeTurn?.status === "paused" && (
            <p>
              {t("overview.turnPaused")}{" "}
              <a href={routePath({ labId: lab.id, page: "chat" })}>
                {t("overview.continueInConversation")}
              </a>
              .
            </p>
          )}
          {overview.activeTurn?.error && <p>{overview.activeTurn.error}</p>}
          {failures.map((run) => (
            <div className="record" key={run.id}>
              <a
                href={routePath({
                  labId: lab.id,
                  page: "experiments",
                  id: run.experimentId,
                  tab: "runs",
                })}
              >
                {t("common.attemptOf", {
                  title:
                    overview.experiments.find(
                      (row) => row.id === run.experimentId,
                    )?.title ?? t("common.experiment"),
                  attempt: run.attempt,
                })}
              </a>
              <p className="meta">
                {run.error ??
                  t("overview.runStatus", {
                    status: statusLabel(run.status).toLowerCase(),
                  })}
              </p>
            </div>
          ))}
        </section>
      )}
      <div className="grid-main">
        <div className="stack">
          <Section
            id="research-questions"
            title={t("common.researchQuestions")}
            action={
              <button
                className="text-button"
                type="button"
                onClick={() => discuss(t("overview.newQuestionPrompt"))}
              >
                {t("overview.exploreQuestion")}
              </button>
            }
          >
            {overview.questions.length ? (
              overview.questions.map((row) => (
                <QuestionRecord key={row.id} row={row} overview={overview} />
              ))
            ) : (
              <Empty title={t("overview.firstQuestion")}>
                {t("overview.firstQuestionBody")}
              </Empty>
            )}
          </Section>
          <Section title={t("overview.recentActivity")}>
            {overview.events.length ? (
              <ol className="timeline">
                {[...overview.events]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 12)
                  .map((event) => (
                    <li key={event.id}>
                      <IdText>{event.message}</IdText>
                      <time dateTime={event.createdAt}>
                        {timestamp(event.createdAt)}
                      </time>
                    </li>
                  ))}
              </ol>
            ) : (
              <Empty title={t("overview.noActivity")}>
                {t("overview.noActivityBody")}
              </Empty>
            )}
          </Section>
        </div>
        <aside className="stack">
          <Section title={t("overview.happeningNow")}>
            {overview.activeTurn && (
              <div className="record">
                <div className="record-heading">
                  <h3>
                    <a href={routePath({ labId: lab.id, page: "chat" })}>
                      {t("overview.picoConversation")}
                    </a>
                  </h3>
                  <Status value={overview.activeTurn.status} />
                </div>
                <p className="meta">
                  {t("overview.modelSteps", {
                    count: overview.activeTurn.steps,
                  })}{" "}
                  · {timestamp(overview.activeTurn.createdAt)}
                </p>
              </div>
            )}
            {activeRuns.map((run) => (
              <div className="record" key={run.id}>
                <div className="record-heading">
                  <h3>
                    <a
                      href={routePath({
                        labId: lab.id,
                        page: "experiments",
                        id: run.experimentId,
                        tab: "runs",
                      })}
                    >
                      {overview.experiments.find(
                        (row) => row.id === run.experimentId,
                      )?.title ?? t("common.experiment")}
                    </a>
                  </h3>
                  <Status value={run.status} />
                </div>
                <p className="meta">
                  {t("common.attempt", { attempt: run.attempt })} ·{" "}
                  {timestamp(run.startedAt ?? run.createdAt)}
                </p>
              </div>
            ))}
            {!overview.activeTurn && !activeRuns.length && (
              <Empty title={t("overview.quiet")}>
                {t("overview.quietBody")}
              </Empty>
            )}
          </Section>
          <Section title={t("overview.recentConclusions")}>
            {overview.conclusions.length ? (
              [...overview.conclusions]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 3)
                .map((row) => (
                  <ConclusionRecord
                    key={row.id}
                    row={row}
                    overview={overview}
                  />
                ))
            ) : (
              <Empty title={t("overview.findingsEmpty")}>
                {t("overview.findingsEmptyBody")}
              </Empty>
            )}
          </Section>
          <Section title={t("overview.library")}>
            <div className="library-links">
              <a href={routePath({ labId: lab.id, page: "library" })}>
                <strong>{overview.papers.length}</strong>
                {t("overview.papers", { count: overview.papers.length })}
              </a>
              <a
                href={routePath({
                  labId: lab.id,
                  page: "library",
                  tab: "datasets",
                })}
              >
                <strong>{overview.datasets.length}</strong>
                {t("overview.datasetVersions", {
                  count: overview.datasets.length,
                })}
              </a>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

export function OverviewPage(props: {
  labId: string;
  questionId?: string;
  discuss: (text: string) => void;
  onRefresh: () => void;
}) {
  const query = useOverviewOverview(props.labId);
  return (
    <QueryState
      loading={query.loading}
      error={query.error}
      hasData={!!query.data}
      refresh={query.refresh}
    >
      {query.data && (
        <Overview
          overview={query.data}
          questionId={props.questionId}
          discuss={props.discuss}
        />
      )}
    </QueryState>
  );
}
