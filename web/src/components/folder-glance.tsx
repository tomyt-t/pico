import type { FileView } from "@pico/server/contracts";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { routePath } from "@/web/app/navigation";
import { bytes } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { hiddenEntries } from "@/web/features/files/files-page";

/** A folder at a glance: its first entries, folders first, with the full
 *  tree one click away in the collection. */
export function FolderGlance({
  labId,
  folder,
  title,
  limit = 10,
  sizes = false,
}: {
  labId: string;
  folder: string;
  title: string;
  limit?: number;
  /** Show file sizes next to the names. */
  sizes?: boolean;
}) {
  const { t } = useTranslation();
  const clean = folder.replace(/\/+$/, "");
  const view = usePoll<FileView>(
    labPath(labId, `/files?path=${encodeURIComponent(clean)}`),
    30_000,
  );
  const entries =
    view.data?.kind === "directory"
      ? [...view.data.entries]
          .filter(
            (entry) =>
              !entry.name.startsWith(".") && !hiddenEntries.has(entry.name),
          )
          .sort((a, b) =>
            a.kind === b.kind
              ? a.name.localeCompare(b.name)
              : a.kind === "directory"
                ? -1
                : 1,
          )
      : [];
  const shown = entries.slice(0, limit);
  return (
    <div className="front-aside-card folder-glance">
      <h3>{title}</h3>
      {view.data?.kind === "directory" && !entries.length && (
        <p className="muted small">{t("files.empty")}</p>
      )}
      {view.error && <p className="muted small">{t("files.notFound")}</p>}
      {shown.length > 0 && (
        <div className="front-files">
          {shown.map((entry) => (
            <a
              key={entry.name}
              href={routePath({
                labId,
                page: "collection",
                path: `${clean}/${entry.name}`,
              })}
            >
              {entry.name}
              {entry.kind === "directory" ? "/" : ""}
              {sizes && entry.kind === "file" && (
                <small className="muted"> · {bytes(entry.size)}</small>
              )}
            </a>
          ))}
          {entries.length > shown.length && (
            <span className="muted">
              {t("common.more", { count: entries.length - shown.length })}
            </span>
          )}
        </div>
      )}
      <a
        className="text-button"
        href={routePath({ labId, page: "collection", path: clean })}
      >
        {t("fronts.openFolder")}
      </a>
    </div>
  );
}
