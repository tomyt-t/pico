import type { FileEntry, FileView, Lab } from "@pico/server/contracts";
import { useEffect, useState } from "react";
import { labPath, request } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { navigate, routePath } from "@/web/app/navigation";
import { FileActions, FilePreview } from "@/web/components/file-preview";
import { bytes, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import {
  Empty,
  Icon,
  Loading,
  Notice,
  PageHeading,
} from "@/web/components/primitives";

type FilePage = "files" | "collection";

function Breadcrumbs({
  labId,
  path,
  page,
}: {
  labId: string;
  path: string;
  page: FilePage;
}) {
  const { t } = useTranslation();
  const parts = path === "." ? [] : path.split("/").filter(Boolean);
  return (
    <nav className="file-breadcrumbs" aria-label={t("files.title")}>
      <a href={routePath({ labId, page, path: "." })}>{t("files.root")}</a>
      {parts.map((part, index) => {
        const target = parts.slice(0, index + 1).join("/");
        return (
          <span key={target}>
            <span aria-hidden="true"> / </span>
            {index === parts.length - 1 ? (
              <strong>{part}</strong>
            ) : (
              <a href={routePath({ labId, page, path: target })}>{part}</a>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Folders that are tooling, not research: never listed. */
export const hiddenEntries = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
]);
const hidden = hiddenEntries;

/** A lazily loaded folder tree. Folders on the way to the open path start expanded. */
function Tree({
  labId,
  dir,
  current,
  depth,
  page,
}: {
  labId: string;
  dir: string;
  current: string;
  depth: number;
  page: FilePage;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    request<FileView>(labPath(labId, `/files?path=${encodeURIComponent(dir)}`))
      .then((view) => {
        if (live && view.kind === "directory") setEntries(view.entries);
      })
      .catch(() => {
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, [labId, dir]);
  if (!entries) return null;
  return (
    <ul className="tree" style={{ "--depth": depth } as React.CSSProperties}>
      {entries
        .filter((entry) => !hidden.has(entry.name))
        .map((entry) => {
          const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
          const active = current === path;
          const open =
            entry.kind === "directory" &&
            (current === path || current.startsWith(`${path}/`));
          return (
            <li key={entry.name}>
              <TreeNode
                labId={labId}
                entry={entry}
                path={path}
                active={active}
                open={open}
                current={current}
                depth={depth}
                page={page}
              />
            </li>
          );
        })}
    </ul>
  );
}

function TreeNode({
  labId,
  entry,
  path,
  active,
  open,
  current,
  depth,
  page,
}: {
  labId: string;
  entry: FileEntry;
  path: string;
  active: boolean;
  open: boolean;
  current: string;
  depth: number;
  page: FilePage;
}) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={`tree-node ${active ? "active" : ""}`}
        aria-current={active ? "true" : undefined}
        onClick={() => {
          if (entry.kind === "directory") setExpanded((value) => !value);
          navigate({ labId, page, path });
        }}
      >
        <span className={`tree-caret ${expanded ? "open" : ""}`}>
          {entry.kind === "directory" ? "›" : ""}
        </span>
        <Icon name={entry.kind === "directory" ? "folder" : "file"} size={14} />
        <span className="tree-name">{entry.name}</span>
      </button>
      {entry.kind === "directory" && expanded && (
        <Tree
          labId={labId}
          dir={path}
          current={current}
          depth={depth + 1}
          page={page}
        />
      )}
    </>
  );
}

function DirectoryTable({
  labId,
  current,
  entries,
  page,
}: {
  labId: string;
  current: string;
  entries: FileEntry[];
  page: FilePage;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return <Empty title={t("files.empty")} />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{t("files.name")}</th>
          <th className="num">{t("files.size")}</th>
          <th>{t("files.modified")}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const target =
            current === "." ? entry.name : `${current}/${entry.name}`;
          return (
            <tr key={entry.name}>
              <td>
                <a
                  className="file-link"
                  href={routePath({ labId, page, path: target })}
                >
                  <Icon
                    name={entry.kind === "directory" ? "folder" : "file"}
                    size={15}
                  />
                  {entry.name}
                </a>
              </td>
              <td className="num">
                {entry.kind === "file" ? bytes(entry.size) : ""}
              </td>
              <td>{entry.modifiedAt ? timestamp(entry.modifiedAt) : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function FilesPage({
  lab,
  path,
  page = "files",
  embedded = false,
  discuss,
}: {
  lab: Lab;
  path?: string;
  page?: FilePage;
  embedded?: boolean;
  discuss?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const current = path || ".";
  const view = usePoll<FileView>(
    labPath(lab.id, `/files?path=${encodeURIComponent(current)}`),
    10_000,
  );
  const data = view.data;
  return (
    <div className={embedded ? "files-page" : "page files-page"}>
      {!embedded && (
        <PageHeading title={t("files.title")}>
          {t("files.subtitle")}
        </PageHeading>
      )}
      <div className="files-split">
        <aside className="files-tree">
          <p className="eyebrow">{t("files.tree")}</p>
          <Tree
            labId={lab.id}
            dir="."
            current={current}
            depth={0}
            page={page}
          />
        </aside>
        <div className="files-main">
          <Breadcrumbs labId={lab.id} path={current} page={page} />
          {view.loading && !data && <Loading>{t("common.loading")}</Loading>}
          {view.error && <Notice error>{view.error}</Notice>}
          {data?.kind === "directory" && (
            <div className="panel file-panel">
              <DirectoryTable
                labId={lab.id}
                current={current}
                entries={data.entries.filter(
                  (entry) => !hidden.has(entry.name),
                )}
                page={page}
              />
            </div>
          )}
          {data?.kind === "file" && (
            <div className="panel file-panel">
              <FileActions
                labId={lab.id}
                path={data.path}
                size={data.size}
                modifiedAt={data.modifiedAt}
                truncated={data.truncated}
              />
              <FilePreview labId={lab.id} file={data} />
              {discuss && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => discuss(`${t("files.title")}: ${data.path}`)}
                >
                  {t("common.discussWithPico")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
