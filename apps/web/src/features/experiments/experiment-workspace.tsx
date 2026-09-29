import type { LabOverview } from "@pico/lab/contracts";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import { Markdown } from "@/web/components/markdown";
import {
  Empty,
  Icon,
  Loading,
  Notice,
  PageHeading,
  Section,
  Status,
} from "@/web/components/primitives";
import { CodeAndData } from "@/web/features/experiments/code-and-data";
import { useExperimentDetail } from "@/web/features/experiments/experiment-queries";
import { RunCard } from "@/web/features/experiments/run-card";

export function ExperimentWorkspace({
  overview,
  id,
  tab = "overview",
  discuss,
  refresh,
}: {
  overview: LabOverview;
  id: string;
  tab?: string;
  discuss: (text: string) => void;
  refresh: () => void;
}) {
  const query = useExperimentDetail(overview.lab.id, id);
  const action = useMutation();
  const detail = query.data;
  const update = () => {
    query.refresh();
    refresh();
  };
  return (
    <div className="page">
      <a
        className="back"
        href={routePath({ labId: overview.lab.id, page: "experiments" })}
      >
        ← Experiments
      </a>
      {query.error && (
        <Notice error>
          {query.error}
          <button className="text-button" type="button" onClick={query.refresh}>
            Retry
          </button>
        </Notice>
      )}
      {query.loading && <Loading>Opening experiment…</Loading>}
      {detail && (
        <>
          <PageHeading
            eyebrow={
              detail.experiment.hypothesisIds.length
                ? "Hypothesis test"
                : "Exploratory experiment"
            }
            title={detail.experiment.title}
            action={
              <button
                className="primary"
                type="button"
                onClick={() =>
                  discuss(
                    `Let's review experiment ${detail.experiment.id}: ${detail.experiment.title}. Inspect its protocol, runs and findings, then propose the next step.`,
                  )
                }
              >
                <Icon name="chat" size={15} />
                Discuss with Pico
              </button>
            }
          >
            {detail.experiment.objective}
          </PageHeading>
          <div className="chip-row" style={{ marginBottom: 18 }}>
            <Status value={detail.experiment.status} />
            <span className="meta">
              Revision {detail.experiment.revision} · {detail.runs.length} runs
              · By {detail.experiment.author.kind}
            </span>
          </div>
          <nav className="tabs" aria-label="Experiment sections">
            {[
              ["overview", "Overview"],
              ["runs", "Runs"],
              ["code", "Code and data"],
            ].map(([key, label]) => (
              <a
                key={key}
                aria-current={tab === key ? "page" : undefined}
                href={routePath({
                  labId: overview.lab.id,
                  page: "experiments",
                  id,
                  tab: key,
                })}
              >
                {label}
              </a>
            ))}
          </nav>
          {tab === "runs" ? (
            <div className="stack">
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    action.busy ||
                    !overview.lab.settings.executionEnabled ||
                    detail.experiment.status === "archived"
                  }
                  onClick={async () => {
                    if (
                      await action.mutate(
                        labPath(overview.lab.id, `/experiments/${id}/runs`),
                        {},
                      )
                    )
                      update();
                  }}
                >
                  {action.busy ? "Requesting…" : "Run current code"}
                </button>
                <span className="meta">
                  {overview.lab.settings.executionEnabled
                    ? "Creates a new attempt with preserved inputs and code."
                    : "Enable local execution in laboratory settings to run code."}
                </span>
              </div>
              {action.error && <Notice error>{action.error}</Notice>}
              {detail.runs.length ? (
                [...detail.runs]
                  .sort((a, b) => b.attempt - a.attempt)
                  .map((run) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      overview={overview}
                      refresh={update}
                    />
                  ))
              ) : (
                <Section title="Execution history">
                  <Empty title="No runs yet">
                    When ready, execute the current code or ask Pico to prepare
                    it.
                  </Empty>
                </Section>
              )}
            </div>
          ) : tab === "code" ? (
            <CodeAndData detail={detail} />
          ) : (
            <div className="grid-main">
              <div className="stack">
                <Section title="Protocol">
                  <Markdown>
                    {detail.experiment.protocol || "No protocol recorded yet."}
                  </Markdown>
                </Section>
                <Section title="Results and interpretation">
                  {detail.results.length ? (
                    detail.results.map((result) => (
                      <article className="record" key={result.id}>
                        <p className="eyebrow">
                          Observations · {result.runIds.length} runs
                        </p>
                        <Markdown>{result.observations}</Markdown>
                        <p className="eyebrow" style={{ marginTop: 18 }}>
                          Interpretation
                        </p>
                        <Markdown>{result.interpretation}</Markdown>
                        {result.limitations && (
                          <p style={{ marginTop: 14 }}>
                            <strong>Limitations:</strong> {result.limitations}
                          </p>
                        )}
                        <p className="meta" style={{ marginTop: 12 }}>
                          By {result.author.kind} ·{" "}
                          {timestamp(result.createdAt)}
                        </p>
                        <details>
                          <summary>Referenced runs</summary>
                          <ul>
                            {result.runIds.map((runId) => (
                              <li key={runId} className="mono">
                                {runId}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </article>
                    ))
                  ) : (
                    <Empty title="No analysis recorded">
                      Pico can interpret the observations after a run finishes.
                    </Empty>
                  )}
                </Section>
              </div>
              <aside className="stack">
                <Section title="Research questions">
                  {detail.questions.length ? (
                    detail.questions.map((question) => (
                      <p key={question.id}>
                        <a
                          href={routePath({
                            labId: overview.lab.id,
                            page: "overview",
                            id: question.id,
                          })}
                        >
                          {question.text}
                        </a>
                      </p>
                    ))
                  ) : (
                    <p className="meta">No linked question recorded.</p>
                  )}
                </Section>
                <Section title="What this tests">
                  {detail.hypotheses.map((hypothesis) => (
                    <article className="record" key={hypothesis.id}>
                      <p>{hypothesis.statement}</p>
                      <Status value={hypothesis.status} />
                    </article>
                  ))}
                  {!detail.hypotheses.length && (
                    <p className="meta">
                      An exploratory experiment. No hypothesis is required to
                      learn from its observations.
                    </p>
                  )}
                  {detail.experiment.criteria.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <p className="eyebrow">Registered criteria</p>
                      {detail.experiment.criteria.map((criterion, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Criteria have no independent IDs; these rows display one versioned protocol.
                        <div className="record" key={index}>
                          <p>{criterion.expectation}</p>
                          <p className="meta mono">
                            {criterion.metric} {criterion.comparator}{" "}
                            {criterion.threshold} {criterion.unit ?? ""}
                            {criterion.split ? ` · ${criterion.split}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
