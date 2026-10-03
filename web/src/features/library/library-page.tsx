import type {
  FileEntry,
  FileView,
  Lab,
  ResearchRecord,
} from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { routePath } from "@/web/app/navigation";
import {
  extensionOf,
  FileActions,
  FilePreview,
} from "@/web/components/file-preview";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Icon, Loading, Notice, Status } from "@/web/components/primitives";
import { FieldsTable, recordHref } from "@/web/components/record-card";
import { useRecords } from "@/web/features/records/record-queries";

const readable = new Set(["pdf", "md", "txt", "html"]);

export interface PaperItem {
  key: string;
  title: string;
  record?: ResearchRecord;
  files: { path: string; entry: FileEntry; extension: string }[];
  modifiedAt: string | null;
}

/** Papers are whatever lives in papers/, joined with paper records that name a file. */
export function paperItems(
  entries: FileEntry[],
  records: ResearchRecord[],
): { items: PaperItem[]; unmatched: ResearchRecord[] } {
  const groups = new Map<string, PaperItem>();
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const extension = extensionOf(entry.name);
    if (!readable.has(extension)) continue;
    const stem = entry.name.replace(/\.[^.]+$/, "");
    const item = groups.get(stem) ?? {
      key: stem,
      title: stem,
      files: [],
      modifiedAt: null,
    };
    item.files.push({ path: `papers/${entry.name}`, entry, extension });
    if (!item.modifiedAt || (entry.modifiedAt ?? "") > item.modifiedAt)
      item.modifiedAt = entry.modifiedAt;
    groups.set(stem, item);
  }
  const matched = new Set<string>();
  for (const record of records) {
    const names = ["file", "text", "path"]
      .map((key) => record.fields[key])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.replace(/^papers\//, "").replace(/\.[^.]+$/, ""));
    const item = names.map((name) => groups.get(name)).find(Boolean);
    if (item) {
      item.record = record;
      item.title = record.title;
      matched.add(record.id);
    }
  }
  const order = (extension: string) =>
    ["pdf", "md", "txt", "html"].indexOf(extension);
  const items = [...groups.values()]
    .map((item) => ({
      ...item,
      files: [...item.files].sort(
        (a, b) => order(a.extension) - order(b.extension),
      ),
    }))
    .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
  return {
    items,
    unmatched: records.filter((record) => !matched.has(record.id)),
  };
}

export function formatLabel(extension: string, textLabel: string): string {
  return extension === "pdf"
    ? "PDF"
    : extension === "md"
      ? textLabel
      : extension.toUpperCase();
}

/** A paper file opens in the sources tab of the collection. */
export function paperRoute(labId: string, path: string): string {
  return routePath({ labId, page: "collection", tab: "sources", path });
}

const sourcesRoute = (labId: string) =>
  routePath({ labId, page: "collection", tab: "sources" });

/** The papers folder joined with the paper records, for lists and the reader. */
export function usePapers(labId: string) {
  const records = useRecords(labId, 10_000);
  const folder = usePoll<FileView>(
    labPath(labId, "/files?path=papers"),
    10_000,
  );
  const entries = folder.data?.kind === "directory" ? folder.data.entries : [];
  return {
    ...paperItems(
      entries,
      (records.data ?? []).filter((record) => record.kind === "paper"),
    ),
    records,
    folder,
  };
}

/** A paper beside its notes: the file on the left, the record on the right. */
export function PaperReader({
  lab,
  path,
  discuss,
}: {
  lab: Lab;
  path: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { items } = usePapers(lab.id);
  const file = usePoll<FileView>(
    labPath(lab.id, `/files?path=${encodeURIComponent(path)}`),
    60_000,
  );
  const item = items.find((candidate) =>
    candidate.files.some((entry) => entry.path === path),
  );
  const data = file.data;
  return (
    <div className="reader-page">
      <a className="back" href={sourcesRoute(lab.id)}>
        ← {t("collection.sources")}
      </a>
      <div className="reader">
        <div className="reader-document">
          {file.loading && !data && <Loading>{t("common.loading")}</Loading>}
          {file.error && <Notice error>{file.error}</Notice>}
          {data?.kind === "file" && (
            <>
              <FileActions
                labId={lab.id}
                path={data.path}
                size={data.size}
                modifiedAt={data.modifiedAt}
                truncated={data.truncated}
              />
              <FilePreview labId={lab.id} file={data} tall />
            </>
          )}
        </div>
        <aside className="reader-side">
          <p className="eyebrow">{t("library.reader.about")}</p>
          <h2>{item?.title ?? path.replace(/^papers\//, "")}</h2>
          {item && item.files.length > 1 && (
            <div className="chip-row">
              {item.files.map((entry) => (
                <a
                  key={entry.path}
                  className={`pill-link ${entry.path === path ? "current" : ""}`}
                  href={paperRoute(lab.id, entry.path)}
                >
                  {formatLabel(entry.extension, t("library.formatText"))}
                </a>
              ))}
            </div>
          )}
          {item?.record ? (
            <>
              {item.record.status && <Status value={item.record.status} />}
              {item.record.body && (
                <div className="reader-notes">
                  <Markdown>{item.record.body}</Markdown>
                </div>
              )}
              <FieldsTable fields={item.record.fields} labId={lab.id} />
              <a className="pill-link" href={recordHref(item.record)}>
                {t("library.reader.record")}
              </a>
            </>
          ) : (
            <p className="muted small">{t("library.reader.noRecord")}</p>
          )}
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="small"
              onClick={() => discuss(`Paper ${path}: `)}
            >
              {t("common.discussWithPico")}
            </button>
            <a
              className="button small"
              href={routePath({
                labId: lab.id,
                page: "collection",
                path: "papers",
              })}
            >
              <Icon name="folder" size={13} />
              {t("library.openFolder")}
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
