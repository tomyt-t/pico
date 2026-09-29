import type { DatasetRegistration } from "@pico/lab/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { errorText, labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { bytes } from "@/web/components/format";
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
          {kind === "papers" ? "Add a paper" : "Register a dataset version"}
        </h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close"
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
              if (!files.length)
                throw new Error(
                  "Choose at least one file for this dataset version.",
                );
              if (
                files.reduce((total, file) => total + file.size, 0) >
                10 * 1024 * 1024
              )
                throw new Error("Choose up to 10 MB of files for one upload.");
              if (new Set(files.map((file) => file.name)).size !== files.length)
                throw new Error("Dataset file names must be unique.");
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
            Add from
            <select
              value={importing ? "identifier" : "text"}
              onChange={(event) =>
                setImporting(event.target.value === "identifier")
              }
            >
              <option value="identifier">DOI or doi.org link</option>
              <option value="text">Text and source supplied by you</option>
            </select>
          </label>
        )}
        {kind === "papers" && importing ? (
          <>
            <label className="field">
              Paper DOI or doi.org link
              <input
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="10.1234/example or https://doi.org/…"
              />
            </label>
            <p className="meta">
              Pico looks up DOI metadata and available abstract text. For arXiv
              papers or full text, use the supplied-text option.
            </p>
          </>
        ) : (
          <>
            <label className="field">
              {kind === "papers" ? "Title" : "Dataset name"}
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {kind === "papers" ? (
              <label className="field">
                Authors
                <input
                  value={authors}
                  onChange={(event) => setAuthors(event.target.value)}
                  placeholder="Names separated by commas"
                />
              </label>
            ) : (
              <div className="field-row">
                <label className="field">
                  Version
                  <input
                    required
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  />
                </label>
                <label className="field">
                  License / terms
                  <input
                    value={license}
                    onChange={(event) => setLicense(event.target.value)}
                    placeholder="As declared by the source"
                  />
                </label>
              </div>
            )}
            <label className="field">
              Source
              <input
                required
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Origin, citation or source URL"
              />
            </label>
            <label className="field">
              {kind === "papers" ? "Source text" : "Description"}
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
                  Files
                  <input
                    type="file"
                    multiple
                    required
                    onChange={(event) =>
                      setFiles(Array.from(event.target.files ?? []))
                    }
                  />
                  <small>
                    Text, tables, images and other input files. Up to 10 MB per
                    upload.
                  </small>
                </label>
                {files.length > 0 && (
                  <p className="meta">
                    {files.length} files ·{" "}
                    {bytes(files.reduce((total, file) => total + file.size, 0))}
                  </p>
                )}
                <Notice>
                  A new version preserves these bytes and their hashes. Future
                  changes should be registered as another version.
                </Notice>
              </>
            )}
          </>
        )}
        <div className="form-actions">
          <button type="button" disabled={preparing} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={preparing || action.busy}
          >
            {preparing || action.busy
              ? "Saving…"
              : kind === "papers"
                ? "Add paper"
                : "Register version"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
