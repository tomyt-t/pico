import type { DatasetRegistration } from "@pico/lab/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { errorText, labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { bytes } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";
import { encodeFile } from "@/web/features/library/encode-file";
import { externalLink } from "@/web/features/library/external-link";

export function AddResource({
  labId,
  kind,
  onClose,
  onSaved,
}: {
  labId: string;
  kind: "papers" | "datasets";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const action = useMutation();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [version, setVersion] = useState("1");
  const [license, setLicense] = useState("");
  const [text, setText] = useState("");
  const [authors, setAuthors] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [identifier, setIdentifier] = useState("");
  const [importing, setImporting] = useState(kind === "papers");
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const prepared = useRef<{
    files: File[];
    payload: DatasetRegistration["files"];
  } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={heading}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2 id={heading}>
          {kind === "papers"
            ? t("resource.addPaper")
            : t("resource.registerVersion")}
        </h2>
        <button
          className="icon-button"
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setLocalError(null);
          setPreparing(true);
          try {
            let saved: unknown;
            if (kind === "papers")
              saved = await action.mutate(
                importing
                  ? labPath(labId, "/papers/import")
                  : labPath(labId, "/papers"),
                importing
                  ? { identifier }
                  : {
                      title: name,
                      authors: authors
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                      identifier,
                      url: externalLink(source) ?? "",
                      source,
                      text,
                    },
              );
            else {
              if (!files.length) throw new Error(t("resource.needFile"));
              if (
                files.reduce((total, file) => total + file.size, 0) >
                10 * 1024 * 1024
              )
                throw new Error(t("resource.maxSize"));
              if (new Set(files.map((file) => file.name)).size !== files.length)
                throw new Error(t("resource.uniqueNames"));
              if (prepared.current?.files !== files)
                prepared.current = {
                  files,
                  payload: await Promise.all(
                    files.map(async (file) => ({
                      path: file.name,
                      content: await encodeFile(file),
                      encoding: "base64" as const,
                    })),
                  ),
                };
              saved = await action.mutate(labPath(labId, "/datasets"), {
                name,
                version,
                description: text,
                source,
                license,
                files: prepared.current.payload,
              } satisfies DatasetRegistration);
            }
            if (saved) onSaved();
          } catch (error) {
            setLocalError(errorText(error));
          } finally {
            setPreparing(false);
          }
        }}
      >
        {(action.error || localError) && (
          <Notice error>{action.error || localError}</Notice>
        )}
        {kind === "papers" && (
          <label className="field">
            {t("resource.addFrom")}
            <select
              value={importing ? "identifier" : "text"}
              onChange={(event) =>
                setImporting(event.target.value === "identifier")
              }
            >
              <option value="identifier">{t("resource.fromDoi")}</option>
              <option value="text">{t("resource.fromText")}</option>
            </select>
          </label>
        )}
        {kind === "papers" && importing ? (
          <>
            <label className="field">
              {t("resource.doi")}
              <input
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={t("resource.doiPlaceholder")}
              />
            </label>
            <p className="meta">{t("resource.doiHint")}</p>
          </>
        ) : (
          <>
            <label className="field">
              {kind === "papers"
                ? t("resource.title")
                : t("resource.datasetName")}
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {kind === "papers" ? (
              <label className="field">
                {t("resource.authors")}
                <input
                  value={authors}
                  onChange={(event) => setAuthors(event.target.value)}
                  placeholder={t("resource.authorsPlaceholder")}
                />
              </label>
            ) : (
              <div className="field-row">
                <label className="field">
                  {t("resource.version")}
                  <input
                    required
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  />
                </label>
                <label className="field">
                  {t("resource.license")}
                  <input
                    value={license}
                    onChange={(event) => setLicense(event.target.value)}
                    placeholder={t("resource.licensePlaceholder")}
                  />
                </label>
              </div>
            )}
            <label className="field">
              {t("common.source")}
              <input
                required
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t("resource.sourcePlaceholder")}
              />
            </label>
            <label className="field">
              {kind === "papers"
                ? t("resource.sourceText")
                : t("resource.description")}
              <textarea
                required={kind === "papers"}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
              />
            </label>
            {kind === "datasets" && (
              <>
                <label className="field">
                  {t("resource.files")}
                  <input
                    type="file"
                    multiple
                    required
                    onChange={(event) =>
                      setFiles(Array.from(event.target.files ?? []))
                    }
                  />
                  <small>{t("resource.filesHint")}</small>
                </label>
                {files.length > 0 && (
                  <p className="meta">
                    {t("common.files", { count: files.length })} ·{" "}
                    {bytes(files.reduce((total, file) => total + file.size, 0))}
                  </p>
                )}
                <Notice>{t("resource.versionNotice")}</Notice>
              </>
            )}
          </>
        )}
        <div className="form-actions">
          <button type="button" disabled={preparing} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={preparing || action.busy}
          >
            {preparing || action.busy
              ? t("common.saving")
              : kind === "papers"
                ? t("library.addPaper")
                : t("resource.submitVersion")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
