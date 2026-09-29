import type { ExperimentDetail } from "@pico/lab/contracts";
import { useEffect, useState } from "react";
import { routePath } from "@/web/app/navigation";
import { languageForPath } from "@/web/components/highlight";
import { useTranslation } from "@/web/components/i18n";
import {
  Code,
  Empty,
  Loading,
  Notice,
  Section,
} from "@/web/components/primitives";
import { Hash } from "@/web/components/record-text";
import {
  useWorkspaceFile,
  useWorkspaceFiles,
} from "@/web/features/experiments/experiment-queries";

export function CodeAndData({ detail }: { detail: ExperimentDetail }) {
  const { t } = useTranslation();
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
      setSelected(
        files.data.files.find(
          (entry) => entry.path === detail.experiment.entrypoint,
        )?.path ??
          files.data.files[0]?.path ??
          "",
      );
  }, [files.data, selected, detail.experiment.entrypoint]);
  const file = useWorkspaceFile(
    detail.experiment.labId,
    detail.experiment.id,
    selected,
  );
  return (
    <div className="stack">
      <Section title={t("code.title")}>
        <p className="meta">{t("code.hint")}</p>
        {files.error && <Notice error>{files.error}</Notice>}
        {files.loading ? (
          <Loading>{t("code.listing")}</Loading>
        ) : files.data?.files.length ? (
          <div className="code-browser">
            <nav className="file-list" aria-label={t("code.files")}>
              {files.data.files.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  aria-current={selected === entry.path}
                  onClick={() => setSelected(entry.path)}
                >
                  {entry.path}
                  {entry.path === detail.experiment.entrypoint && (
                    <span className="entry-badge">{t("code.entry")}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="code-content">
              <div className="file-heading mono">{selected}</div>
              {file.error ? (
                <Notice error>{file.error}</Notice>
              ) : file.loading ? (
                <Loading>{t("code.reading")}</Loading>
              ) : (
                <>
                  <Code language={languageForPath(selected)}>
                    {file.data?.content ?? ""}
                  </Code>
                  {file.data?.clipped && <Notice>{t("code.truncated")}</Notice>}
                </>
              )}
            </div>
          </div>
        ) : (
          <Empty title={t("code.noFiles")}>{t("code.noFilesBody")}</Empty>
        )}
      </Section>
      <Section title={t("code.datasets")}>
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
                <span>
                  {t("common.files", { count: dataset.files.length })}
                </span>
                <span>{dataset.source}</span>
              </div>
              <p className="meta" style={{ marginTop: 8 }}>
                {t("code.manifest")} <Hash value={dataset.manifestHash} />
              </p>
            </article>
          ))
        ) : (
          <Empty title={t("code.noDatasets")}>{t("code.noDatasetsBody")}</Empty>
        )}
      </Section>
    </div>
  );
}
