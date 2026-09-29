import type { LabOverview } from "@pico/lab/contracts";
import { useState } from "react";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import { Empty, Icon, PageHeading, Status } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { useExperimentsOverview } from "@/web/features/experiments/experiment-queries";
import { ExperimentWorkspace } from "@/web/features/experiments/experiment-workspace";
import { latestRun } from "@/web/features/experiments/metric-comparison";
import { RunComparison } from "@/web/features/experiments/run-comparison";

export function Experiments({
  overview,
  id,
  tab,
  discuss,
  refresh,
}: {
  overview: LabOverview;
  id?: string;
  tab?: string;
  discuss: (text: string) => void;
  refresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  if (id)
    return (
      <ExperimentWorkspace
        key={id}
        overview={overview}
        id={id}
        tab={tab}
        discuss={discuss}
        refresh={refresh}
      />
    );
  const entries = overview.experiments.filter(
    (entry) =>
      (!search ||
        `${entry.title} ${entry.objective}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!question || entry.questionIds.includes(question)) &&
      (!status ||
        entry.status === status ||
        latestRun(overview.runs, entry.id)?.status === status),
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="Experiment workspace"
        title="From ideas to observations."
        action={
          <button
            className="primary"
            type="button"
            onClick={() =>
              discuss(
                "Let's prepare a new experiment. Review the questions we have and help me define its objective, protocol and inputs.",
              )
            }
          >
            <Icon name="plus" size={15} />
            Plan with Pico
          </button>
        }
      >
        Protocols, code and every attempt, connected to the questions they
        investigate.
      </PageHeading>
      {comparing ? (
        <RunComparison
          overview={overview}
          selected={selected}
          onSelection={setSelected}
          onClose={() => setComparing(false)}
        />
      ) : (
        <>
          <div className="toolbar">
            <label className="sr-only" htmlFor="experiment-search">
              Search experiments
            </label>
            <input
              id="experiment-search"
              type="search"
              placeholder="Search experiments…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label>
              <span className="sr-only">Question</span>
              <select
                aria-label="Filter by question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              >
                <option value="">All questions</option>
                {overview.questions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Status</span>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                {[
                  "draft",
                  "ready",
                  "queued",
                  "running",
                  "succeeded",
                  "failed",
                  "archived",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/^./, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="panel experiment-list">
            {entries.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <span className="sr-only">Compare</span>
                      </th>
                      <th>Experiment</th>
                      <th>Status</th>
                      <th>Latest attempt</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const run = latestRun(overview.runs, entry.id);
                      return (
                        <tr key={entry.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select latest run of ${entry.title} for comparison`}
                              checked={!!run && selected.includes(run.id)}
                              disabled={
                                !run ||
                                (selected.length >= 4 &&
                                  !selected.includes(run.id))
                              }
                              onChange={(event) => {
                                if (run)
                                  setSelected(
                                    event.target.checked
                                      ? [...selected, run.id]
                                      : selected.filter((id) => id !== run.id),
                                  );
                              }}
                            />
                          </td>
                          <td>
                            <h3>
                              <a
                                href={routePath({
                                  labId: overview.lab.id,
                                  page: "experiments",
                                  id: entry.id,
                                })}
                              >
                                {entry.title}
                              </a>
                            </h3>
                            <div className="meta">
                              {entry.hypothesisIds.length
                                ? "Hypothesis test"
                                : "Exploratory"}{" "}
                              ·{" "}
                              {entry.questionIds
                                .map(
                                  (id) =>
                                    overview.questions.find(
                                      (row) => row.id === id,
                                    )?.text,
                                )
                                .filter(Boolean)
                                .join(" · ") || "No linked question"}
                            </div>
                          </td>
                          <td>
                            <Status value={entry.status} />
                          </td>
                          <td>
                            {run ? (
                              <>
                                <a
                                  href={routePath({
                                    labId: overview.lab.id,
                                    page: "experiments",
                                    id: entry.id,
                                    tab: "runs",
                                  })}
                                >
                                  Attempt {run.attempt}
                                </a>
                                <div style={{ marginTop: 5 }}>
                                  <Status value={run.status} />
                                </div>
                              </>
                            ) : (
                              <span className="meta">Not run yet</span>
                            )}
                          </td>
                          <td className="meta">{timestamp(entry.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={
                  overview.experiments.length
                    ? "No experiments match these filters"
                    : "Your first experiment starts with a plan"
                }
              >
                {overview.experiments.length
                  ? "Try another question, status or search term."
                  : "Discuss a question with Pico to create an exploratory experiment or a hypothesis test."}
              </Empty>
            )}
          </div>
          {selected.length > 0 && (
            <div className="comparison">
              <span className="meta">
                {selected.length} executions selected · choose 2–4
              </span>
              <div className="actions">
                <button
                  className="small"
                  type="button"
                  onClick={() => setSelected([])}
                >
                  Clear
                </button>
                <button
                  className="primary small"
                  type="button"
                  disabled={selected.length < 2}
                  onClick={() => setComparing(true)}
                >
                  Compare runs
                </button>
              </div>
            </div>
          )}
          {overview.runs.length >= 2 && !selected.length && (
            <p className="meta" style={{ marginTop: 16 }}>
              Select experiments to compare their latest runs, or{" "}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setSelected(overview.runs.slice(0, 2).map((run) => run.id));
                  setComparing(true);
                }}
              >
                choose any two executions
              </button>
              , including attempts of the same experiment.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function ExperimentsPage(props: {
  labId: string;
  id?: string;
  tab?: string;
  discuss: (text: string) => void;
  onRefresh: () => void;
}) {
  const query = useExperimentsOverview(props.labId);
  return (
    <QueryState
      loading={query.loading}
      error={query.error}
      hasData={!!query.data}
      refresh={query.refresh}
    >
      {query.data && (
        <Experiments
          overview={query.data}
          id={props.id}
          tab={props.tab}
          refresh={() => {
            query.refresh();
            props.onRefresh();
          }}
          discuss={props.discuss}
        />
      )}
    </QueryState>
  );
}
