import type { Lab, LabContext } from "@pico/server/contracts";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { labPath } from "@/web/api/http-client";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import { relativeTime } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Icon, type IconName, Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { CampaignsPane } from "@/web/features/campaigns/campaign-settings";
import { AgentsPane } from "./agent-settings";
import { ResourcesPane } from "./instruction-settings";

export type SettingsSection =
  | "laboratory"
  | "agents"
  | "campaigns"
  | "resources";

const sectionIcons: Record<SettingsSection, IconName> = {
  laboratory: "experiment",
  agents: "evolution",
  campaigns: "flag",
  resources: "file",
};

/** One settings section: heading, scrolling body and a footer that stays put. */
export function Pane({
  title,
  hint,
  onClose,
  onSubmit,
  footer,
  children,
}: {
  title: string;
  hint?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="settings-pane-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className="settings-pane-head">
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="settings-body">{children}</div>
      {footer && <div className="settings-foot">{footer}</div>}
    </form>
  );
}

/** The footer of a pane: what is unsaved, and the way to keep or drop it. */
export function PaneFooter({
  dirty,
  saved,
  busy,
  onDiscard,
  onCancel,
  saveLabel,
}: {
  dirty?: string;
  saved?: boolean;
  busy: boolean;
  onDiscard?: () => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {dirty ? (
        <span className="settings-dirty">
          <span className="dot pending" />
          {t("agents.unsaved", { names: dirty })}
        </span>
      ) : saved ? (
        <span className="settings-saved" role="status">
          {t("agents.contentSaved")}
        </span>
      ) : null}
      <span className="spacer" />
      {onDiscard && dirty ? (
        <button type="button" onClick={onDiscard} disabled={busy}>
          {t("agents.discard")}
        </button>
      ) : onCancel ? (
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      ) : null}
      <button type="submit" className="primary" disabled={busy || !dirty}>
        {busy ? t("common.saving") : (saveLabel ?? t("common.save"))}
      </button>
    </>
  );
}

/** Creating a lab asks only for a name. Everything else emerges in the conversation. */
export function LabForm({
  onSaved,
  onCancel,
}: {
  onSaved: (lab: Lab) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const health = usePoll<{ labsDir: string }>("/health", 60_000);
  const action = useAction();
  const [name, setName] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await action.run<Lab>("/labs", { name });
        if (saved) onSaved(saved);
      }}
    >
      <label className="field">
        {t("settings.name")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <small>
          {t("settings.nameHint", {
            labsDir: health.data?.labsDir ?? "~/pico-labs",
          })}
        </small>
      </label>
      {action.error && <Notice error>{action.error}</Notice>}
      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={action.busy || !name.trim()}
        >
          {action.busy ? t("settings.saving") : t("settings.create")}
        </button>
      </div>
    </form>
  );
}

/** Name, research line and the laboratory context, saved together. */
export function LabPane({
  lab,
  onSaved,
  onClose,
}: {
  lab: Lab;
  onSaved: (lab: Lab) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const context = usePoll<LabContext>(labPath(lab.id, "/context"), 15_000);
  const action = useAction();
  const [name, setName] = useState(lab.name);
  const [researchLine, setResearchLine] = useState(lab.researchLine);
  const [content, setContent] = useState<string>();
  const [saved, setSaved] = useState(false);
  const storedContent = context.data?.content ?? "";
  const draftContent = content ?? storedContent;
  const labDirty = name !== lab.name || researchLine !== lab.researchLine;
  const contextDirty = content !== undefined && content !== storedContent;
  const dirty = [
    labDirty ? t("agents.labSettings") : "",
    contextDirty ? t("overview.pico") : "",
  ]
    .filter(Boolean)
    .join(", ");
  const submit = async () => {
    setSaved(false);
    if (contextDirty) {
      const ok = await action.run(
        labPath(lab.id, "/context"),
        { content: draftContent },
        "PUT",
      );
      if (!ok) return;
      setContent(undefined);
      context.refresh();
    }
    if (labDirty) {
      const updated = await action.run<Lab>(
        labPath(lab.id),
        { name, researchLine },
        "PATCH",
      );
      if (updated) onSaved(updated);
      return;
    }
    setSaved(true);
  };
  return (
    <Pane
      title={t("agents.labSettings")}
      hint={t("settings.labHint")}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <PaneFooter
          dirty={dirty}
          saved={saved}
          busy={action.busy}
          onDiscard={() => {
            setName(lab.name);
            setResearchLine(lab.researchLine);
            setContent(undefined);
          }}
          onCancel={onClose}
        />
      }
    >
      <label className="field">
        {t("settings.name")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="field">
        {t("settings.researchLine")}
        <textarea
          value={researchLine}
          onChange={(event) => setResearchLine(event.target.value)}
        />
        <small>{t("settings.researchLineHint")}</small>
      </label>
      <QueryState
        loading={context.loading}
        error={context.error}
        hasData={!!context.data}
        refresh={context.refresh}
      >
        {context.data && (
          <div className="settings-editor">
            <div className="settings-editor-head">
              <b className="settings-editor-title">{t("overview.pico")}</b>
              <span className="meta">
                {t("settings.contextMeta", {
                  revision: context.data.revision,
                  time: relativeTime(context.data.updatedAt),
                })}
              </span>
            </div>
            <div className="settings-editor-body">
              <label className="field">
                <span className="sr-only">{t("overview.pico")}</span>
                <textarea
                  rows={14}
                  value={draftContent}
                  onChange={(event) => setContent(event.target.value)}
                />
                <small>{t("overview.picoHint")}</small>
              </label>
            </div>
          </div>
        )}
      </QueryState>
      {action.error && <Notice error>{action.error}</Notice>}
    </Pane>
  );
}

export function Settings({
  mode,
  lab,
  onClose,
  onSaved,
}: {
  mode: "edit" | "new";
  lab?: Lab;
  onClose: () => void;
  onSaved: (lab: Lab) => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<SettingsSection>(
    lab ? "laboratory" : "agents",
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => dialog.current?.close();
  if (mode === "new")
    return (
      <dialog className="modal" ref={dialog} onClose={onClose}>
        <div className="modal-heading">
          <h2>{t("settings.newTitle")}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label={t("common.close")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="subheading">{t("settings.intro")}</p>
        <LabForm onSaved={onSaved} onCancel={close} />
      </dialog>
    );
  const sections: SettingsSection[] = [
    ...(lab ? (["laboratory"] as const) : []),
    "agents",
    "campaigns",
    "resources",
  ];
  const labels: Record<SettingsSection, string> = {
    laboratory: t("agents.labSettings"),
    agents: t("agents.settingsTitle"),
    campaigns: t("campaigns.title"),
    resources: t("agents.resources"),
  };
  return (
    <dialog
      className="modal settings-modal"
      ref={dialog}
      onClose={onClose}
      aria-label={t("shell.settings")}
    >
      <nav className="settings-nav" aria-label={t("settings.sections")}>
        <h2>{t("shell.settings")}</h2>
        <div role="tablist" aria-orientation="vertical">
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={section === id}
              aria-controls={`settings-pane-${id}`}
              onClick={() => setSection(id)}
            >
              <Icon name={sectionIcons[id]} size={16} />
              {labels[id]}
            </button>
          ))}
        </div>
        {lab && (
          <p className="settings-scope">
            {t("settings.scopeNote", { name: lab.name })}
          </p>
        )}
      </nav>
      <section
        className="settings-pane"
        role="tabpanel"
        id={`settings-pane-${section}`}
        aria-labelledby={`settings-tab-${section}`}
      >
        {section === "laboratory" && lab ? (
          <LabPane key={lab.id} lab={lab} onSaved={onSaved} onClose={close} />
        ) : section === "agents" ? (
          <AgentsPane onClose={close} />
        ) : section === "campaigns" ? (
          <CampaignsPane
            onClose={close}
            onAgents={() => setSection("agents")}
          />
        ) : (
          <ResourcesPane onClose={close} />
        )}
      </section>
    </dialog>
  );
}
