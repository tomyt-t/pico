import type { AgentSkill, PromptTemplate } from "@pico/server/contracts";
import { useState } from "react";
import { errorText, request } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { relativeTime } from "@/web/components/format";
import { i18n, useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { Pane, PaneFooter } from "./settings-dialog";

type Field = { key: string; label: string; rows: number; allowEmpty?: boolean };

/** A prompt template or a skill as one editable item with its own fields. */
interface Resource {
  id: string;
  path: string;
  kind: "prompt" | "skill";
  name: string;
  description: string;
  updatedAt: string;
  values: Record<string, string>;
  fields: Field[];
}

export function resources(
  prompts: PromptTemplate[],
  skills: AgentSkill[],
): Resource[] {
  const t = i18n.t;
  return [
    ...prompts.map<Resource>((prompt) => ({
      id: `prompt:${prompt.id}`,
      path: `/prompts/${encodeURIComponent(prompt.id)}`,
      kind: "prompt",
      name: prompt.name,
      description: prompt.content.split("\n")[0] ?? "",
      updatedAt: prompt.updatedAt,
      values: { content: prompt.content },
      fields: [{ key: "content", label: t("agents.instructions"), rows: 16 }],
    })),
    ...skills.map<Resource>((skill) => ({
      id: `skill:${skill.id}`,
      path: `/skills/${encodeURIComponent(skill.id)}`,
      kind: "skill",
      name: skill.name,
      description: skill.description,
      updatedAt: skill.updatedAt,
      values: {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        examples: skill.examples,
      },
      fields: [
        { key: "name", label: t("settings.name"), rows: 1 },
        { key: "description", label: t("agents.description"), rows: 2 },
        { key: "instructions", label: t("agents.instructions"), rows: 12 },
        {
          key: "examples",
          label: t("agents.examples"),
          rows: 12,
          allowEmpty: true,
        },
      ],
    })),
  ];
}

export function ResourceList({
  items,
  selected,
  onSelect,
  title,
}: {
  items: Resource[];
  selected: string | null;
  onSelect: (id: string) => void;
  title: string;
}) {
  return (
    <section className="settings-group">
      <h4 className="sheet-label">{title}</h4>
      <div className="settings-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-expanded={selected === item.id}
            onClick={() => onSelect(item.id)}
          >
            <span className="name">
              <b>{item.name}</b>
              <span>{item.description}</span>
            </span>
            <span className="meta">{relativeTime(item.updatedAt)}</span>
            <Icon name="chevron" size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function ResourceEditor({
  item,
  draft,
  onChange,
}: {
  item: Resource;
  draft: Record<string, string>;
  onChange: (draft: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-editor">
      <div className="settings-editor-head">
        <b className="settings-editor-title">{draft.name ?? item.name}</b>
        {item.kind === "prompt" && (
          <span className="meta">{t("agents.templateHint")}</span>
        )}
      </div>
      <div className="settings-editor-body">
        {item.fields.map((field) => (
          <label className="field" key={field.key}>
            {field.label}
            <textarea
              rows={field.rows}
              required={!field.allowEmpty}
              value={draft[field.key] ?? item.values[field.key] ?? ""}
              onChange={(event) =>
                onChange({ ...draft, [field.key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Shared prompts, skills and their examples, edited one at a time and saved together. */
export function ResourcesPane({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const skills = usePoll<AgentSkill[]>("/skills", 60_000);
  const prompts = usePoll<PromptTemplate[]>("/prompts", 60_000);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const items = resources(prompts.data ?? [], skills.data ?? []);
  const changed = items.filter((item) =>
    Object.entries(drafts[item.id] ?? {}).some(
      ([key, value]) => value !== item.values[key],
    ),
  );
  const dirty = changed.map((item) => item.name).join(", ");
  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      for (const item of changed) {
        await request(item.path, {
          method: "PATCH",
          body: { ...item.values, ...drafts[item.id] },
        });
        setDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
      setSaved(true);
      skills.refresh();
      prompts.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const current = items.find((item) => item.id === selected);
  return (
    <Pane
      title={t("agents.resources")}
      hint={t("agents.resourcesHint")}
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
        loading={skills.loading || prompts.loading}
        error={skills.error ?? prompts.error}
        hasData={!!skills.data && !!prompts.data}
        refresh={() => {
          skills.refresh();
          prompts.refresh();
        }}
      >
        <ResourceList
          title={t("agents.prompts")}
          items={items.filter((item) => item.kind === "prompt")}
          selected={selected}
          onSelect={(id) => setSelected(selected === id ? null : id)}
        />
        <ResourceList
          title={t("agents.skills")}
          items={items.filter((item) => item.kind === "skill")}
          selected={selected}
          onSelect={(id) => setSelected(selected === id ? null : id)}
        />
        {current && (
          <ResourceEditor
            key={current.id}
            item={current}
            draft={drafts[current.id] ?? {}}
            onChange={(draft) => {
              setDrafts({ ...drafts, [current.id]: draft });
              setSaved(false);
            }}
          />
        )}
      </QueryState>
      {error && <Notice error>{error}</Notice>}
    </Pane>
  );
}
