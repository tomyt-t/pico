import type { LabOverview } from "@pico/lab/contracts";
import { useEffect, useRef } from "react";
import { parseRoute, routePath } from "@/web/app/navigation";
import { author, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
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
import { Hash, IdText } from "@/web/components/record-text";
import { AttemptComparison } from "@/web/features/experiments/attempt-comparison";
import { CodeAndData } from "@/web/features/experiments/code-and-data";
import { ExecutionOptions } from "@/web/features/experiments/execution-options";
import { useExperimentDetail } from "@/web/features/experiments/experiment-queries";
import { ResultEvidence } from "@/web/features/experiments/result-evidence";
import { ResultHistory } from "@/web/features/experiments/result-history";
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
  const { t } = useTranslation();
  const query = useExperimentDetail(overview.lab.id, id);
  const detail = query.data;
  const focus =
    typeof window === "undefined"
      ? undefined
      : parseRoute(window.location.hash)?.focus;
  const scrolled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focus) {
      scrolled.current = undefined;
      return;
    }
    if (scrolled.current === focus || !detail) return;
    const target = document.getElementById(focus);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      scrolled.current = focus;
    }
  }, [detail, focus]);
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
        {t("workspace.back")}
      </a>
      {query.error && (
        <Notice error>
          {query.error}
          <button className="text-button" type="button" onClick={query.refresh}>
            {t("common.retry")}
          </button>
        </Notice>
      )}
      {query.loading && <Loading>{t("workspace.opening")}</Loading>}
      {detail && (
        <>
          <PageHeading
            eyebrow={
              detail.experiment.hypothesisIds.length
                ? t("common.hypothesisTest")
                : t("workspace.exploratoryExperiment")
            }
            title={detail.experiment.title}
            action={
              <button
                className="primary"
                type="button"
                onClick={() =>
                  discuss(
                    t("workspace.reviewPrompt", {
                      id: detail.experiment.id,
                      title: detail.experiment.title,
                    }),
                  )
                }
              >
                <Icon name="chat" size={15} />
                {t("common.discussWithPico")}
              </button>
            }
          >
            {detail.experiment.objective}
          </PageHeading>
          <div className="chip-row" style={{ marginBottom: 18 }}>
            <Status value={detail.experiment.status} />
            <span className="meta">
              {t("workspace.meta", {
                revision: detail.experiment.revision,
                runs: t("common.runs", { count: detail.runs.length }),
                author: author(detail.experiment.author.kind),
              })}
            </span>
          </div>
          <nav className="tabs" aria-label={t("workspace.sections")}>
            {(["overview", "runs", "code"] as const).map((key) => (
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
                {t(`workspace.tabs.${key}`)}
              </a>
            ))}
          </nav>
          {tab === "runs" ? (
            <div className="stack">
              <ExecutionOptions
                key={detail.experiment.id}
                lab={overview.lab}
                experiment={detail.experiment}
                refresh={update}
              />
              <AttemptComparison runs={detail.runs} />
              {detail.runs.length ? (
                [...detail.runs]
                  .sort((a, b) => b.attempt - a.attempt)
                  .map((run, index) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      overview={overview}
                      refresh={update}
                      expanded={index === 0}
                    />
                  ))
              ) : (
                <Section title={t("workspace.history")}>
                  <Empty title={t("workspace.noRuns")}>
                    {t("workspace.noRunsBody")}
                  </Empty>
                </Section>
              )}
            </div>
          ) : tab === "code" ? (
            <CodeAndData detail={detail} />
          ) : (
            <div className="grid-main">
              <div className="stack">
                <Section title={t("workspace.protocol")}>
                  <Markdown>
                    {detail.experiment.protocol || t("workspace.noProtocol")}
                  </Markdown>
                </Section>
                <Section title={t("workspace.results")}>
                  {detail.results.length ? (
                    detail.results.map((result) => (
                      <article
                        className="record"
                        key={result.id}
                        id={`result-${result.id}`}
                      >
                        <p className="eyebrow">
                          {t("workspace.observations", {
                            runs: t("common.runs", {
                              count: result.runIds.length,
                            }),
                          })}
                          {" · "}
                          {t("overview.revision", {
                            revision: result.revision,
                          })}
                        </p>
                        <Markdown>{result.observations}</Markdown>
                        <p className="eyebrow" style={{ marginTop: 18 }}>
                          {t("workspace.interpretation")}
                        </p>
                        <Markdown>{result.interpretation}</Markdown>
                        {result.limitations && (
                          <p className="limitations">
                            <strong>{t("common.limitations")}</strong>{" "}
                            <IdText>{result.limitations}</IdText>
                          </p>
                        )}
                        <p className="meta" style={{ marginTop: 12 }}>
                          {t("common.by", {
                            author: author(result.author.kind),
                          })}{" "}
                          · {timestamp(result.createdAt)}
                        </p>
                        <details>
                          <summary>{t("workspace.referencedRuns")}</summary>
                          <ul>
                            {result.runIds.map((runId) => (
                              <li key={runId}>
                                <a
                                  href={routePath({
                                    labId: overview.lab.id,
                                    page: "experiments",
                                    id,
                                    tab: "runs",
                                    focus: `run-${runId}`,
                                  })}
                                >
                                  {t("common.attempt", {
                                    attempt:
                                      detail.runs.find(
                                        (run) => run.id === runId,
                                      )?.attempt ?? "?",
                                  })}{" "}
                                  <Hash value={runId} />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </details>
                        <ResultEvidence result={result} runs={detail.runs} />
                        <ResultHistory
                          key={`${result.id}:${result.revision}`}
                          result={result}
                          runs={detail.runs}
                          focus={focus}
                        />
                      </article>
                    ))
                  ) : (
                    <Empty title={t("workspace.noAnalysis")}>
                      {t("workspace.noAnalysisBody")}
                    </Empty>
                  )}
                </Section>
              </div>
              <aside className="stack">
                <Section title={t("common.researchQuestions")}>
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
                    <p className="meta">{t("common.noLinkedQuestion")}</p>
                  )}
                </Section>
                <Section title={t("workspace.whatThisTests")}>
                  {detail.hypotheses.map((hypothesis) => (
                    <article className="record" key={hypothesis.id}>
                      <p>{hypothesis.statement}</p>
                      <Status value={hypothesis.status} />
                      {hypothesis.needsReview && (
                        <p className="notice">{t("common.needsReview")}</p>
                      )}
                    </article>
                  ))}
                  {!detail.hypotheses.length && (
                    <p className="meta">{t("workspace.exploratoryNote")}</p>
                  )}
                  {detail.experiment.criteria.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <p className="eyebrow">{t("workspace.criteria")}</p>
                      {detail.experiment.criteria.map((criterion, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Criteria have no independent IDs; these rows display one versioned protocol.
                        <div className="record" key={index}>
                          <p>{criterion.expectation}</p>
                          {criterion.hypothesisRevision !== undefined && (
                            <p className="meta">
                              {t("overview.revision", {
                                revision: criterion.hypothesisRevision,
                              })}
                            </p>
                          )}
                          <p className="meta mono">
                            {criterion.metric} {criterion.comparator}{" "}
                            {criterion.threshold} {criterion.unit ?? ""}
                            {criterion.split ? ` · ${criterion.split}` : ""}
                            {criterion.step !== undefined
                              ? ` · step ${criterion.step}`
                              : ""}
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
