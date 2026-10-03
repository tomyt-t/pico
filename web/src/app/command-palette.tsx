import type { Job, Lab, ResearchRecord } from "@pico/server/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { labPath } from "@/web/api/http-client";
import { usePoll } from "@/web/api/use-poll";
import { navigate, type Page, recordRoute } from "@/web/app/navigation";
import { kindLabel } from "@/web/components/format";
import { i18n, useTranslation } from "@/web/components/i18n";
import { Icon, type IconName, Status } from "@/web/components/primitives";
import { relevantJobs } from "@/web/features/investigations/investigation-links";
import { useRecords } from "@/web/features/records/record-queries";

export type Command =
  | { kind: "navigation"; id: Page | "settings"; title: string; icon: IconName }
  | { kind: "record"; id: string; title: string; record: ResearchRecord }
  | { kind: "job"; id: string; title: string; job: Job }
  | { kind: "page"; id: string; title: string; record: ResearchRecord }
  | { kind: "lab"; id: string; title: string; lab: Lab };

/** Result groups in display order. */
export const commandGroups = [
  "navigation",
  "record",
  "job",
  "page",
  "lab",
] as const satisfies readonly Command["kind"][];

/** The sidebar's fixed pages, plus the settings dialog. */
const navigation: { id: Page | "settings"; icon: IconName }[] = [
  { id: "chat", icon: "chat" },
  { id: "panorama", icon: "overview" },
  { id: "investigations", icon: "experiment" },
  { id: "evolution", icon: "evolution" },
  { id: "collection", icon: "library" },
  { id: "settings", icon: "settings" },
];

export const resultLimit = 12;
const suggestedRecords = 6;

/** Lowercase without diacritics, so "conclusao" finds "Conclusão". */
export function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The platform's command modifier, for labels and hints. */
export function modifierKey(): string {
  const platform =
    typeof navigator === "undefined"
      ? ""
      : `${navigator.platform} ${navigator.userAgent}`;
  return /mac|iphone|ipad/i.test(platform) ? "⌘" : "Ctrl";
}

/** Ranks commands for a query: title or id starting with the query first, then
 *  other substrings, keeping the given order within each tier; at most
 *  `resultLimit`. An empty query suggests the navigation, the most recently
 *  updated records and the running executions. */
export function searchCommands(items: Command[], query: string): Command[] {
  const needle = plain(query.trim());
  if (!needle) {
    const recent = items
      .filter(
        (item): item is Extract<Command, { kind: "record" }> =>
          item.kind === "record",
      )
      .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, suggestedRecords);
    return [
      ...items.filter((item) => item.kind === "navigation"),
      ...recent,
      ...items.filter(
        (item) => item.kind === "job" && item.job.status === "running",
      ),
    ];
  }
  const matches = items.flatMap((item) => {
    const fields = [item.title, item.id].map(plain);
    const rank = fields.some((field) => field.startsWith(needle))
      ? 0
      : fields.some((field) => field.includes(needle))
        ? 1
        : -1;
    return rank < 0 ? [] : [{ item, rank }];
  });
  return matches
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.item)
    .slice(0, resultLimit);
}

export function groupCommands(results: Command[]) {
  return commandGroups
    .map((kind) => ({
      kind,
      items: results.filter((item) => item.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
}

/** Everything the palette can open from a laboratory, in display order. */
export function commandsFor(
  lab: Lab,
  labs: Lab[],
  records: ResearchRecord[],
  jobs: Job[],
): Command[] {
  const newest = [...records].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  return [
    ...navigation.map(
      (entry): Command => ({
        kind: "navigation",
        id: entry.id,
        title:
          entry.id === "settings"
            ? i18n.t("shell.settings")
            : i18n.t(`shell.pages.${entry.id}`),
        icon: entry.icon,
      }),
    ),
    ...newest
      .filter((record) => record.kind !== "page")
      .map(
        (record): Command => ({
          kind: "record",
          id: record.id,
          title: record.title,
          record,
        }),
      ),
    ...relevantJobs(jobs, jobs.length).map(
      (job): Command => ({ kind: "job", id: job.id, title: job.name, job }),
    ),
    ...newest
      .filter((record) => record.kind === "page")
      .map(
        (record): Command => ({
          kind: "page",
          id: record.id,
          title: record.title,
          record,
        }),
      ),
    ...labs
      .filter((entry) => entry.id !== lab.id)
      .map(
        (entry): Command => ({
          kind: "lab",
          id: entry.id,
          title: entry.name,
          lab: entry,
        }),
      ),
  ];
}

/** Opens what a command points to. Settings is a dialog, not a route. */
export function runCommand(
  command: Command,
  labId: string,
  onSettings: (value: "edit" | "new") => void,
): void {
  switch (command.kind) {
    case "navigation":
      if (command.id === "settings") onSettings("edit");
      else navigate({ labId, page: command.id });
      return;
    case "record":
      navigate(recordRoute(labId, command.record));
      return;
    case "job":
      navigate({ labId, page: "experiments", id: command.id });
      return;
    case "page":
      navigate({ labId, page: "pages", id: command.id });
      return;
    case "lab":
      navigate({ labId: command.id, page: "chat" });
  }
}

function OptionContent({ command }: { command: Command }) {
  if (command.kind === "navigation")
    return (
      <>
        <Icon name={command.icon} size={16} />
        <span className="palette-copy">
          <strong>{command.title}</strong>
        </span>
      </>
    );
  if (command.kind === "lab")
    return (
      <>
        <Icon name="experiment" size={16} />
        <span className="palette-copy">
          <strong>{command.title}</strong>
          {command.lab.researchLine && (
            <small>{command.lab.researchLine}</small>
          )}
        </span>
      </>
    );
  if (command.kind === "job")
    return (
      <>
        <Icon name="experiment" size={16} />
        <span className="palette-copy">
          <strong>{command.title}</strong>
          <Status value={command.job.status} />
        </span>
      </>
    );
  return (
    <>
      <Icon name="file" size={16} />
      <span className="palette-copy">
        <strong>{command.title}</strong>
        <span className="kind-chip">{kindLabel(command.record.kind)}</span>
        {command.record.status && <Status value={command.record.status} />}
      </span>
    </>
  );
}

/** The dialog itself, fed with ready-made commands so tests can render it. */
export function PaletteDialog({
  commands,
  onClose,
  onSelect,
}: {
  commands: Command[];
  onClose: () => void;
  onSelect: (command: Command) => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const groups = groupCommands(searchCommands(commands, query));
  const visible = groups.flatMap((group) => group.items);
  const current = visible.length ? Math.min(active, visible.length - 1) : 0;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const modifier = modifierKey();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => element?.close();
  }, []);
  useEffect(() => {
    document
      .getElementById(`${baseId}-option-${current}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [baseId, current]);
  const choose = (command: Command) => {
    dialog.current?.close();
    onSelect(command);
  };
  const move = (delta: number) => {
    if (visible.length)
      setActive((current + delta + visible.length) % visible.length);
  };
  return (
    <dialog
      className="palette"
      ref={dialog}
      aria-label={t("palette.title")}
      onClose={() => {
        // StrictMode may reopen the dialog before its queued close event fires.
        if (!dialog.current?.open) onClose();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <label className="lab-search" htmlFor={`${baseId}-input`}>
        <Icon name="search" size={16} />
        <input
          ref={input}
          id={`${baseId}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          aria-expanded={true}
          aria-autocomplete="list"
          aria-controls={`${baseId}-results`}
          aria-activedescendant={visible.length ? optionId(current) : undefined}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter") {
              const command = visible[current];
              if (!command) return;
              event.preventDefault();
              choose(command);
            } else if (event.key === "Escape") {
              event.preventDefault();
              dialog.current?.close();
            }
          }}
        />
      </label>
      <div className="palette-results">
        <div
          role="listbox"
          id={`${baseId}-results`}
          aria-label={t("palette.results")}
        >
          {groups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: A listbox groups its options with the ARIA role; fieldset is for form controls.
            <div
              key={group.kind}
              role="group"
              aria-labelledby={`${baseId}-${group.kind}`}
            >
              <p
                id={`${baseId}-${group.kind}`}
                className="eyebrow palette-group"
              >
                {t(`palette.groups.${group.kind}`)}
              </p>
              {group.items.map((command) => {
                const index = visible.indexOf(command);
                return (
                  <button
                    key={`${command.kind}:${command.id}`}
                    id={optionId(index)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    className="palette-option"
                    aria-selected={index === current}
                    onMouseMove={() => {
                      if (index !== current) setActive(index);
                    }}
                    onClick={() => choose(command)}
                  >
                    <OptionContent command={command} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {!visible.length && (
          <p className="palette-empty" role="status">
            {t("palette.empty")}
          </p>
        )}
      </div>
      <footer className="palette-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          {t("palette.hints.move")}
        </span>
        <span>
          <kbd>↵</kbd>
          {t("palette.hints.select")}
        </span>
        <span>
          <kbd>{modifier}K</kbd>
          {t("palette.hints.search")}
        </span>
        <span>
          <kbd>{modifier}/</kbd>
          {t("palette.hints.compose")}
        </span>
      </footer>
    </dialog>
  );
}

/** Fetches the laboratory's records and executions while the palette is open. */
export function CommandPalette({
  lab,
  labs,
  onClose,
  onSettings,
}: {
  lab: Lab;
  labs: Lab[];
  onClose: () => void;
  onSettings: (value: "edit" | "new") => void;
}) {
  const records = useRecords(lab.id);
  const jobs = usePoll<Job[]>(labPath(lab.id, "/jobs"), 5_000);
  return (
    <PaletteDialog
      commands={commandsFor(lab, labs, records.data ?? [], jobs.data ?? [])}
      onClose={onClose}
      onSelect={(command) => runCommand(command, lab.id, onSettings)}
    />
  );
}
