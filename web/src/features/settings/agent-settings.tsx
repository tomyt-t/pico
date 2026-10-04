import {
  type AgentDefinition,
  type AgentDefinitionPatch,
  type ModelSummary,
  type ThinkingLevel,
  thinkingLevels,
} from "@pico/server/contracts";
import { useState } from "react";
import { errorText, request } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import {
  profileDescription,
  profileName,
} from "@/web/features/campaigns/catalog";
import { Pane, PaneFooter } from "./settings-dialog";

/** Pending edits for one profile; `model` is "provider/id" as the select shows it. */
export type AgentDraft = Partial<
  Pick<
    AgentDefinition,
    "name" | "description" | "whenToUse" | "instructions" | "thinking"
  >
> & { model?: string };

export const modelKey = (agent: {
  provider: string | null;
  model: string | null;
}) => (agent.provider && agent.model ? `${agent.provider}/${agent.model}` : "");

/** The fields that actually changed, as the server expects them. */
export function agentPatch(
  agent: AgentDefinition,
  draft: AgentDraft,
  models: ModelSummary[],
): AgentDefinitionPatch | null {
  const patch: AgentDefinitionPatch = {};
  for (const key of [
    "name",
    "description",
    "whenToUse",
    "instructions",
  ] as const)
    if (draft[key] !== undefined && draft[key] !== agent[key])
      patch[key] = draft[key];
  const key = draft.model ?? modelKey(agent);
  const selected = models.find(
    (entry) => modelKey({ provider: entry.provider, model: entry.id }) === key,
  );
  const thinking = draft.thinking ?? agent.thinking;
  if (selected && (key !== modelKey(agent) || thinking !== agent.thinking)) {
    patch.provider = selected.provider;
    patch.model = selected.id;
    patch.thinking = selected.reasoning ? thinking : "off";
  }
  return Object.keys(patch).length ? patch : null;
}

export function AgentRow({
  agent,
  draft,
  models,
  selected,
  onChange,
  onSelect,
}: {
  agent: AgentDefinition;
  draft: AgentDraft;
  models: ModelSummary[];
  selected: boolean;
  onChange: (draft: AgentDraft) => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const model = draft.model ?? modelKey(agent);
  const current = models.find(
    (entry) =>
      modelKey({ provider: entry.provider, model: entry.id }) === model,
  );
  const thinking = draft.thinking ?? agent.thinking;
  const name = draft.name ?? agent.name;
  return (
    <div className={`agent-table-row${selected ? " is-selected" : ""}`}>
      <span className="name">
        <b>{profileName(agent.id, name)}</b>
        <span>
          {profileDescription(agent.id, draft.description ?? agent.description)}
        </span>
      </span>
      <label className="cell">
        <span className="sr-only">{t("agents.model")}</span>
        <select
          required
          value={model}
          onChange={(event) =>
            onChange({ ...draft, model: event.target.value })
          }
        >
          <option value="" disabled>
            {t("agents.chooseModel")}
          </option>
          {model && !current && (
            <option value={model} disabled>
              {model} · {t("agents.unavailable")}
            </option>
          )}
          {models.map((entry) => (
            <option
              key={`${entry.provider}/${entry.id}`}
              value={`${entry.provider}/${entry.id}`}
            >
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cell">
        <span className="sr-only">{t("chat.thinkingLabel")}</span>
        <select
          value={current?.reasoning === false ? "off" : thinking}
          disabled={!current?.reasoning}
          onChange={(event) =>
            onChange({
              ...draft,
              thinking: event.target.value as ThinkingLevel,
            })
          }
        >
          {thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {t(`settings.thinkingLevels.${level}`)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        aria-expanded={selected}
        aria-label={t("agents.editing", { name: profileName(agent.id, name) })}
        onClick={onSelect}
      >
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

export function AgentEditor({
  agent,
  draft,
  onChange,
}: {
  agent: AgentDefinition;
  draft: AgentDraft;
  onChange: (draft: AgentDraft) => void;
}) {
  const { t } = useTranslation();
  const field = (
    key: "name" | "description" | "whenToUse" | "instructions",
    label: string,
    rows: number,
  ) => (
    <label className="field" key={key}>
      {label}
      <textarea
        rows={rows}
        required
        value={draft[key] ?? agent[key]}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <div className="settings-editor">
      <div className="settings-editor-head">
        <b className="settings-editor-title">
          {t("agents.editing", {
            name: profileName(agent.id, draft.name ?? agent.name),
          })}
        </b>
        {agent.skillId && (
          <span className="meta">
            {t("agents.primarySkill")}: {agent.skillId}
          </span>
        )}
      </div>
      <div className="settings-editor-body">
        {field("name", t("settings.name"), 1)}
        {field("description", t("agents.description"), 2)}
        {field("whenToUse", t("agents.whenToUse"), 3)}
        {field("instructions", t("agents.instructions"), 10)}
      </div>
    </div>
  );
}

export function AgentsPane({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const catalog = usePoll<AgentDefinition[]>("/agents", 60_000);
  const models = usePoll<ModelSummary[]>("/models", 60_000);
  const [drafts, setDrafts] = useState<Record<string, AgentDraft>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const agents = catalog.data ?? [];
  const available = models.data ?? [];
  const changed = agents.filter((agent) =>
    agentPatch(agent, drafts[agent.id] ?? {}, available),
  );
  const dirty = changed
    .map((agent) => profileName(agent.id, drafts[agent.id]?.name ?? agent.name))
    .join(", ");
  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      for (const agent of changed) {
        const patch = agentPatch(agent, drafts[agent.id] ?? {}, available);
        if (!patch) continue;
        await request(`/agents/${encodeURIComponent(agent.id)}`, {
          method: "PATCH",
          body: patch,
        });
        setDrafts((current) => {
          const next = { ...current };
          delete next[agent.id];
          return next;
        });
      }
      setSaved(true);
      catalog.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pane
      title={t("agents.settingsTitle")}
      hint={t("agents.paneHint")}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <PaneFooter
          dirty={dirty}
          saved={saved}
          busy={busy}
          onDiscard={() => setDrafts({})}
          onCancel={onClose}
        />
      }
    >
      <QueryState
        loading={catalog.loading || models.loading}
        error={catalog.error ?? models.error}
        hasData={!!catalog.data && !!models.data}
        refresh={() => {
          catalog.refresh();
          models.refresh();
        }}
      >
        {models.data?.length === 0 && <Notice>{t("agents.noModels")}</Notice>}
        <div className="agent-table">
          <div className="agent-table-row">
            <span>{t("agents.profile")}</span>
            <span>{t("chat.modelLabel")}</span>
            <span>{t("chat.thinkingLabel")}</span>
            <span />
          </div>
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              draft={drafts[agent.id] ?? {}}
              models={available}
              selected={selected === agent.id}
              onChange={(draft) => {
                setDrafts({ ...drafts, [agent.id]: draft });
                setSaved(false);
              }}
              onSelect={() =>
                setSelected(selected === agent.id ? null : agent.id)
              }
            />
          ))}
        </div>
        {agents
          .filter((agent) => agent.id === selected)
          .map((agent) => (
            <AgentEditor
              key={agent.id}
              agent={agent}
              draft={drafts[agent.id] ?? {}}
              onChange={(draft) => {
                setDrafts({ ...drafts, [agent.id]: draft });
                setSaved(false);
              }}
            />
          ))}
      </QueryState>
      <p className="meta">{t("agents.globalHint")}</p>
      {error && <Notice error>{error}</Notice>}
    </Pane>
  );
}
