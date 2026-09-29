import type { DatasetVersion, LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { bytes, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { PageHeading, Section } from "@/web/components/primitives";

export function DatasetDetail({
  dataset,
  overview,
}: {
  dataset: DatasetVersion;
  overview: LabOverview;
}) {
  const { t } = useTranslation();
  const experiments = overview.experiments.filter((entry) =>
    entry.datasetVersionIds.includes(dataset.id),
  );
  const runs = overview.runs.filter((run) =>
    run.snapshot?.datasetInputs.some(
      (input) => input.datasetVersionId === dataset.id,
    ),
  );
  return (
    <>
      <PageHeading eyebrow={t("dataset.eyebrow")} title={dataset.name}>
        {dataset.description}
      </PageHeading>
      <div className="chip-row" style={{ marginBottom: 24 }}>
        <span className="status">
          {t("common.version", { version: dataset.version })}
        </span>
        <span className="meta">
          {t("common.files", { count: dataset.files.length })} ·{" "}
          {bytes(dataset.files.reduce((total, file) => total + file.size, 0))}
        </span>
      </div>
      <div className="grid-main">
        <div className="stack">
          <Section title={t("dataset.preservedFiles")}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("dataset.file")}</th>
                    <th>{t("dataset.size")}</th>
                    <th>SHA-256</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.files.map((file) => (
                    <tr key={file.path}>
                      <td>{file.path}</td>
                      <td>{bytes(file.size)}</td>
                      <td className="mono">{file.sha256}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={t("dataset.usage")}>
            <h3>{t("dataset.linkedExperiments")}</h3>
            {experiments.length ? (
              <ul className="link-list">
                {experiments.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={routePath({
                        labId: dataset.labId,
                        page: "experiments",
                        id: entry.id,
                      })}
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">{t("dataset.noLinkedExperiments")}</p>
            )}
            <h3 style={{ marginTop: 20 }}>{t("dataset.preservedInRuns")}</h3>
            {runs.length ? (
              <ul className="link-list">
                {runs.map((run) => (
                  <li key={run.id}>
                    <a
                      href={routePath({
                        labId: dataset.labId,
                        page: "experiments",
                        id: run.experimentId,
                        tab: "runs",
                      })}
                    >
                      {t("common.attemptOf", {
                        title:
                          overview.experiments.find(
                            (entry) => entry.id === run.experimentId,
                          )?.title ?? t("common.experiment"),
                        attempt: run.attempt,
                      })}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">{t("dataset.noRunsCaptured")}</p>
            )}
          </Section>
        </div>
        <Section title={t("paper.provenance")}>
          <dl className="details-grid">
            <div>
              <dt>{t("common.source")}</dt>
              <dd>{dataset.source}</dd>
            </div>
            <div>
              <dt>{t("dataset.license")}</dt>
              <dd>{dataset.license || t("common.notRecorded")}</dd>
            </div>
            <div>
              <dt>{t("dataset.created")}</dt>
              <dd>{timestamp(dataset.createdAt)}</dd>
            </div>
            <div>
              <dt>{t("dataset.splits")}</dt>
              <dd>
                {Object.entries(dataset.splits)
                  .map(([name, count]) => `${name}: ${count}`)
                  .join(", ") || t("dataset.notDeclared")}
              </dd>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>{t("dataset.manifestHash")}</dt>
              <dd className="mono">{dataset.manifestHash}</dd>
            </div>
          </dl>
        </Section>
      </div>
    </>
  );
}
