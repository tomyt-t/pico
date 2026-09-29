import type { DatasetVersion, LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { bytes, timestamp } from "@/web/components/format";
import { PageHeading, Section } from "@/web/components/primitives";

export function DatasetDetail({
  dataset,
  overview,
}: {
  dataset: DatasetVersion;
  overview: LabOverview;
}) {
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
      <PageHeading eyebrow="Library · dataset version" title={dataset.name}>
        {dataset.description}
      </PageHeading>
      <div className="chip-row" style={{ marginBottom: 24 }}>
        <span className="status">Version {dataset.version}</span>
        <span className="meta">
          {dataset.files.length} files ·{" "}
          {bytes(dataset.files.reduce((total, file) => total + file.size, 0))}
        </span>
      </div>
      <div className="grid-main">
        <div className="stack">
          <Section title="Preserved files">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Size</th>
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
          <Section title="Usage">
            <h3>Current experiment links</h3>
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
              <p className="meta">No current experiment links.</p>
            )}
            <h3 style={{ marginTop: 20 }}>Preserved in runs</h3>
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
                      {overview.experiments.find(
                        (entry) => entry.id === run.experimentId,
                      )?.title ?? "Experiment"}{" "}
                      · attempt {run.attempt}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">No run has captured this version yet.</p>
            )}
          </Section>
        </div>
        <Section title="Provenance">
          <dl className="details-grid">
            <div>
              <dt>Source</dt>
              <dd>{dataset.source}</dd>
            </div>
            <div>
              <dt>Declared license</dt>
              <dd>{dataset.license || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{timestamp(dataset.createdAt)}</dd>
            </div>
            <div>
              <dt>Splits</dt>
              <dd>
                {Object.entries(dataset.splits)
                  .map(([name, count]) => `${name}: ${count}`)
                  .join(", ") || "Not declared"}
              </dd>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <dt>Manifest hash</dt>
              <dd className="mono">{dataset.manifestHash}</dd>
            </div>
          </dl>
        </Section>
      </div>
    </>
  );
}
