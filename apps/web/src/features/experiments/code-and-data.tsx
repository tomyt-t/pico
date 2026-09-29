import type { ExperimentDetail } from "@pico/lab/contracts";
import { useEffect, useState } from "react";
import { routePath } from "@/web/app/navigation";
import {
  Code,
  Empty,
  Loading,
  Notice,
  Section,
} from "@/web/components/primitives";
import {
  useWorkspaceFile,
  useWorkspaceFiles,
} from "@/web/features/experiments/experiment-queries";

export function CodeAndData({ detail }: { detail: ExperimentDetail }) {
  const files = useWorkspaceFiles(
    detail.experiment.labId,
    detail.experiment.id,
  );
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (
      files.data &&
      !files.data.files.some((entry) => entry.path === selected)
    )
      setSelected(files.data.files[0]?.path ?? "");
  }, [files.data, selected]);
  const file = useWorkspaceFile(
    detail.experiment.labId,
    detail.experiment.id,
    selected,
  );
  return (
    <div className="stack">
      <Section title="Current working code">
        <p className="meta">
          These files can evolve. Each run preserves its own code snapshot,
          listed in the Runs tab.
        </p>
        {files.error && <Notice error>{files.error}</Notice>}
        {files.loading ? (
          <Loading>Listing files…</Loading>
        ) : files.data?.files.length ? (
          <div className="code-browser">
            <nav className="file-list" aria-label="Experiment files">
              {files.data.files.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  aria-current={selected === entry.path}
                  onClick={() => setSelected(entry.path)}
                >
                  {entry.path}
                </button>
              ))}
            </nav>
            <div className="code-content">
              <div className="file-heading mono">{selected}</div>
              {file.error ? (
                <Notice error>{file.error}</Notice>
              ) : file.loading ? (
                <Loading>Reading file…</Loading>
              ) : (
                <>
                  <Code>{file.data?.content ?? ""}</Code>
                  {file.data?.clipped && (
                    <Notice>This file preview is truncated.</Notice>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <Empty title="No working files yet">
            Pico can prepare the code through the conversation.
          </Empty>
        )}
      </Section>
      <Section title="Dataset versions">
        {detail.datasets.length ? (
          detail.datasets.map((dataset) => (
            <article className="record" key={dataset.id}>
              <h3>
                <a
                  href={routePath({
                    labId: dataset.labId,
                    page: "library",
                    id: dataset.id,
                    tab: "datasets",
                  })}
                >
                  {dataset.name} · {dataset.version}
                </a>
              </h3>
              <p>{dataset.description}</p>
              <div className="record-meta">
                <span>{dataset.files.length} files</span>
                <span>{dataset.source}</span>
              </div>
              <p className="meta mono" style={{ marginTop: 8 }}>
                Manifest {dataset.manifestHash}
              </p>
            </article>
          ))
        ) : (
          <Empty title="No dataset versions linked">
            Inputs are attached to the experiment and frozen into each run.
          </Empty>
        )}
      </Section>
    </div>
  );
}
