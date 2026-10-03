import type { Lab } from "@pico/server/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@/web/components/i18n";
import { Icon } from "@/web/components/primitives";

export function LabAvatar({ name }: { name?: string }) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : words[0]?.slice(0, 2);
  return (
    <span className="lab-avatar" aria-hidden="true">
      {letters?.toLocaleUpperCase() || <Icon name="experiment" size={18} />}
    </span>
  );
}

export function LabSwitcher({
  labs,
  labId,
  onClose,
  onSelect,
  onCreate,
}: {
  labs: Lab[];
  labId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const searchId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const matches = labs.filter((lab) =>
    `${lab.name} ${lab.researchLine}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    search.current?.focus();
    return () => element?.close();
  }, []);

  return (
    <dialog
      className="lab-picker"
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        // StrictMode may reopen the dialog before its queued close event fires.
        if (!dialog.current?.open) onClose();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <header className="lab-picker-heading">
        <h2 id={titleId}>{t("shell.yourLaboratories")}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label={t("common.close")}
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="lab-picker-body">
        <p>{t("shell.laboratoriesDescription")}</p>
        <label className="lab-search" htmlFor={searchId}>
          <Icon name="search" size={16} />
          <input
            ref={search}
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("shell.searchLaboratories")}
            aria-label={t("shell.searchLaboratories")}
          />
        </label>
        <div className="lab-picker-list">
          {matches.length ? (
            matches.map((lab) => (
              <button
                key={lab.id}
                type="button"
                className="lab-picker-item"
                onClick={() => {
                  dialog.current?.close();
                  onSelect(lab.id);
                }}
                aria-current={lab.id === labId ? "true" : undefined}
              >
                <LabAvatar name={lab.name} />
                <span className="lab-picker-copy">
                  <strong>{lab.name}</strong>
                  {lab.researchLine && <small>{lab.researchLine}</small>}
                </span>
                {lab.id === labId && (
                  <span className="lab-current-label">
                    {t("shell.currentLaboratory")}
                  </span>
                )}
                <Icon name={lab.id === labId ? "check" : "arrow"} size={14} />
              </button>
            ))
          ) : (
            <p className="lab-picker-empty" role="status">
              {t("shell.noMatchingLaboratories")}
            </p>
          )}
        </div>
        <footer className="lab-picker-footer">
          <span className="meta">
            {t("shell.laboratoryCount", { count: labs.length })}
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              dialog.current?.close();
              onCreate();
            }}
          >
            <Icon name="plus" size={16} />
            {t("app.createLaboratory")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
