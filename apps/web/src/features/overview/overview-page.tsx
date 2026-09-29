import type { LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import {
  Empty,
  Icon,
  PageHeading,
  Section,
  Status,
} from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { ConclusionRecord } from "@/web/features/overview/conclusion-detail";
import { useOverviewOverview } from "@/web/features/overview/overview-queries";
import { QuestionRecord } from "@/web/features/overview/question-detail";
import { questionRecords } from "@/web/features/overview/question-records";

export function Overview({
  overview,
  questionId,
  discuss,
}: {
  overview: LabOverview;
  questionId?: string;
  discuss: (text: string) => void;
}) {
  const { lab } = overview;
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
            ← Overview
          </a>
          <Empty title="Question not found">
            This question is not part of the selected laboratory.
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
          ← Overview
        </a>
        <PageHeading
          eyebrow="Research question"
          title={question.text}
          action={
            <button
              className="primary"
              type="button"
              onClick={() =>
                discuss(
                  `Let's review question ${question.id}: ${question.text}. What do the recorded findings show, and what should we investigate next?`,
                )
              }
            >
              <Icon name="chat" size={15} />
              Discuss with Pico
            </button>
          }
        >
          {question.context}
        </PageHeading>
        <div className="chip-row" style={{ marginBottom: 24 }}>
          <Status value={question.status} />
          <span className="meta">
            Revision {question.revision} · Updated{" "}
            {timestamp(question.updatedAt)}
          </span>
        </div>
        <div className="grid-main">
          <div className="stack">
            <Section title="Hypotheses">
              {records.hypotheses.length ? (
                records.hypotheses.map((row) => (
                  <article key={row.id} className="record">
                    <div className="record-heading">
                      <h3>{row.statement}</h3>
                      <Status value={row.status} />
                    </div>
                    <p>{row.rationale}</p>
                    {row.assessment && (
                      <p>
                        <strong>Assessment:</strong> {row.assessment}
                      </p>
                    )}
                    <div className="record-meta">
                      <span>Revision {row.revision}</span>
                      <span>By {row.author.kind}</span>
                    </div>
                  </article>
                ))
              ) : (
                <Empty title="No hypotheses recorded">
                  Exploration can begin with this question and an experiment.
                </Empty>
              )}
            </Section>
            <Section title="Experiments">
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
                          ? "Hypothesis test"
                          : "Exploratory"}
                      </span>
                      <span>
                        {
                          overview.runs.filter(
                            (run) => run.experimentId === row.id,
                          ).length
                        }{" "}
                        runs
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <Empty title="No experiments yet">
                  Plan the next investigation in the conversation.
                </Empty>
              )}
            </Section>
          </div>
          <Section title="What we have learned">
            {records.conclusions.length ? (
              records.conclusions.map((row) => (
                <ConclusionRecord row={row} overview={overview} key={row.id} />
              ))
            ) : (
              <Empty title="No conclusion recorded">
                Conclusions will connect the findings to this question.
              </Empty>
            )}
          </Section>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="Laboratory overview"
        title="The research, in view."
        action={
          <button
            className="primary"
            type="button"
            onClick={() =>
              discuss(
                "Review the current laboratory records and help me choose the next useful research step.",
              )
            }
          >
            <Icon name="chat" size={15} />
            Discuss next steps
          </button>
        }
      >
        Follow the questions, work in progress and findings from the same
        conversation.
      </PageHeading>
      {lab.researchLine && (
        <section className="direction" aria-label="Research direction">
          <p className="eyebrow">Research direction</p>
          <p>{lab.researchLine}</p>
        </section>
      )}
      <div className="stats">
        <div className="stat">
          <strong>
            {
              overview.questions.filter((entry) =>
                ["open", "partially_answered"].includes(entry.status),
              ).length
            }
          </strong>
          <span>Open questions</span>
        </div>
        <div className="stat">
          <strong>{overview.experiments.length}</strong>
          <span>Experiments</span>
        </div>
        <div className="stat">
          <strong>{activeRuns.length}</strong>
          <span>Active runs</span>
        </div>
        <div className="stat">
          <strong>
            {
              overview.conclusions.filter(
                (entry) => entry.status !== "retracted",
              ).length
            }
          </strong>
          <span>Standing conclusions</span>
        </div>
      </div>
      {(failures.length > 0 ||
        overview.activeTurn?.status === "paused" ||
        overview.activeTurn?.error) && (
        <section className="panel" style={{ marginBottom: 22 }}>
          <div className="section-heading">
            <h2>Needs attention</h2>
          </div>
          {overview.activeTurn?.status === "paused" && (
            <p>
              Pico's turn is paused.{" "}
              <a href={routePath({ labId: lab.id, page: "chat" })}>
                Continue in the conversation
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
                {overview.experiments.find((row) => row.id === run.experimentId)
                  ?.title ?? "Experiment"}{" "}
                · attempt {run.attempt}
              </a>
              <p className="meta">
                {run.error ?? `Run ${run.status.replaceAll("_", " ")}`}
              </p>
            </div>
          ))}
        </section>
      )}
      <div className="grid-main">
        <div className="stack">
          <Section
            title="Research questions"
            action={
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  discuss(
                    "Let's define a new research question for this laboratory.",
                  )
                }
              >
                Explore a question
              </button>
            }
          >
            {overview.questions.length ? (
              overview.questions.map((row) => (
                <QuestionRecord key={row.id} row={row} overview={overview} />
              ))
            ) : (
              <Empty title="Your first question starts in conversation">
                Tell Pico what you want to investigate. The question and its
                progress will appear here.
              </Empty>
            )}
          </Section>
          <Section title="Recent activity">
            {overview.events.length ? (
              <ol className="timeline">
                {[...overview.events]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 12)
                  .map((event) => (
                    <li key={event.id}>
                      {event.message}
                      <time dateTime={event.createdAt}>
                        {timestamp(event.createdAt)}
                      </time>
                    </li>
                  ))}
              </ol>
            ) : (
              <Empty title="No recorded changes yet">
                Changes made through Pico's tools will appear here.
              </Empty>
            )}
          </Section>
        </div>
        <aside className="stack">
          <Section title="Happening now">
            {overview.activeTurn && (
              <div className="record">
                <div className="record-heading">
                  <h3>
                    <a href={routePath({ labId: lab.id, page: "chat" })}>
                      Pico's conversation
                    </a>
                  </h3>
                  <Status value={overview.activeTurn.status} />
                </div>
                <p className="meta">{overview.activeTurn.steps} model steps</p>
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
                      )?.title ?? "Experiment"}
                    </a>
                  </h3>
                  <Status value={run.status} />
                </div>
                <p className="meta">
                  Attempt {run.attempt} ·{" "}
                  {timestamp(run.startedAt ?? run.createdAt)}
                </p>
              </div>
            ))}
            {!overview.activeTurn && !activeRuns.length && (
              <Empty title="The laboratory is quiet">
                Start the next investigation with Pico.
              </Empty>
            )}
          </Section>
          <Section title="Recent conclusions">
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
              <Empty title="Findings will gather here">
                Each conclusion retains its sources and limitations.
              </Empty>
            )}
          </Section>
          <Section title="Library">
            <div className="record-meta">
              <a href={routePath({ labId: lab.id, page: "library" })}>
                {overview.papers.length} papers
              </a>
              <a
                href={routePath({
                  labId: lab.id,
                  page: "library",
                  tab: "datasets",
                })}
              >
                {overview.datasets.length} dataset versions
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
