import type { LabOverview } from "@pico/lab/contracts";
import { useState } from "react";
import { routePath } from "@/web/app/navigation";
import { statusLabel, timestamp } from "@/web/components/format";
import { Trans, useTranslation } from "@/web/components/i18n";
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
  const { t } = useTranslation();
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
        eyebrow={t("experiments.eyebrow")}
        title={t("experiments.title")}
        action={
          <button
            className="primary"
            type="button"
            onClick={() => discuss(t("experiments.planPrompt"))}
          >
            <Icon name="plus" size={15} />
            {t("experiments.plan")}
          </button>
        }
      >
        {t("experiments.subtitle")}
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
              {t("experiments.search")}
            </label>
            <input
              id="experiment-search"
              type="search"
              placeholder={t("experiments.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label>
              <span className="sr-only">{t("experiments.question")}</span>
              <select
                aria-label={t("experiments.filterQuestion")}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              >
                <option value="">{t("experiments.allQuestions")}</option>
                {overview.questions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t("experiments.status")}</span>
              <select
                aria-label={t("experiments.filterStatus")}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t("experiments.allStatuses")}</option>
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
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="panel experiment-list">
            {entries.length ? (
              <div className="table-scroll">
                <table className="data-table experiment-table">
                  <thead>
                    <tr>
                      <th>
                        <span className="sr-only">
                          {t("experiments.compare")}
                        </span>
                      </th>
                      <th>{t("experiments.experiment")}</th>
                      <th>{t("experiments.status")}</th>
                      <th>{t("experiments.latestAttempt")}</th>
                      <th>{t("experiments.updated")}</th>
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
                              aria-label={t("experiments.selectLatest", {
                                title: entry.title,
                              })}
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
                                ? t("common.hypothesisTest")
                                : t("common.exploratory")}{" "}
                              ·{" "}
                              {entry.questionIds
                                .map(
                                  (id) =>
                                    overview.questions.find(
                                      (row) => row.id === id,
                                    )?.text,
                                )
                                .filter(Boolean)
                                .join(" · ") || t("common.noLinkedQuestion")}
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
                                  {t("common.attempt", {
                                    attempt: run.attempt,
                                  })}
                                </a>
                                <div style={{ marginTop: 5 }}>
                                  <Status value={run.status} />
                                </div>
                              </>
                            ) : (
                              <span className="meta">
                                {t("experiments.notRun")}
                              </span>
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
                    ? t("experiments.noMatch")
                    : t("experiments.firstExperiment")
                }
              >
                {overview.experiments.length
                  ? t("experiments.noMatchBody")
                  : t("experiments.firstExperimentBody")}
              </Empty>
            )}
          </div>
          {selected.length > 0 && (
            <div className="comparison">
              <span className="meta">
                {t("experiments.selected", { count: selected.length })}
              </span>
              <div className="actions">
                <button
                  className="small"
                  type="button"
                  onClick={() => setSelected([])}
                >
                  {t("experiments.clear")}
                </button>
                <button
                  className="primary small"
                  type="button"
                  disabled={selected.length < 2}
                  onClick={() => setComparing(true)}
                >
                  {t("experiments.compareRuns")}
                </button>
              </div>
            </div>
          )}
          {overview.runs.length >= 2 && !selected.length && (
            <p className="meta" style={{ marginTop: 16 }}>
              <Trans
                i18nKey="experiments.compareHint"
                components={{
                  choose: (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setSelected(
                          overview.runs.slice(0, 2).map((run) => run.id),
                        );
                        setComparing(true);
                      }}
                    />
                  ),
                }}
              />
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
