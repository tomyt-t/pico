import { currentLanguage, i18n } from "@/web/components/i18n";
import { ptBR } from "@/web/components/locales/pt-BR";

type StatusKey = keyof typeof ptBR.status;
type AuthorKey = keyof typeof ptBR.author;
type KindKey = keyof typeof ptBR.kinds;
type ToolKey = keyof typeof ptBR.tools;

export function locale(): string {
  return currentLanguage();
}

/** Known statuses are translated; the model's free-form ones are shown as written. */
export function statusLabel(value: string): string {
  return value in ptBR.status
    ? i18n.t(`status.${value as StatusKey}`)
    : value.toLowerCase().replaceAll("_", " ");
}

/** A CSS class fragment for a status: `status-${statusClass(value)}`. */
export function statusClass(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function kindLabel(value: string, plural = false): string {
  if (value in ptBR.kinds)
    return i18n.t(`${plural ? "kindsPlural" : "kinds"}.${value as KindKey}`);
  return titleCase(value);
}

export function author(kind: string): string {
  return authorLabel(kind);
}

/** Who wrote something, for people: Pico, the researcher, a profile by name
 *  or a campaign by title. Ids stay only when no name is known. */
export function authorLabel(
  author: string,
  names?: Map<string, string>,
): string {
  const separator = author.indexOf(":");
  const kind = separator < 0 ? author : author.slice(0, separator);
  const id = separator < 0 ? "" : author.slice(separator + 1);
  if (kind === "subagent" && id)
    return names?.get(id) ?? i18n.t("author.subagent");
  if (kind === "campaign" && id) {
    const title = names?.get(id);
    return title
      ? i18n.t("author.campaignNamed", { title })
      : i18n.t("author.campaign");
  }
  return author in ptBR.author
    ? i18n.t(`author.${author as AuthorKey}`)
    : author;
}

export function timestamp(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "")
    return i18n.t("common.notRecorded");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? i18n.t("common.unknownTime")
    : date.toLocaleString(locale(), {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function relativeTime(value: string | number, now = Date.now()): string {
  const elapsed = (now - new Date(value).getTime()) / 1000;
  if (Number.isNaN(elapsed) || elapsed < 0 || elapsed >= 86_400 * 7)
    return timestamp(value);
  if (elapsed < 45) return i18n.t("common.justNow");
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (elapsed < 3600) return format.format(-Math.round(elapsed / 60), "minute");
  if (elapsed < 86_400)
    return format.format(-Math.round(elapsed / 3600), "hour");
  return format.format(-Math.round(elapsed / 86_400), "day");
}

/** "30 set": the day a cited record last moved. */
export function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? i18n.t("common.unknownTime")
    : date
        .toLocaleDateString(locale(), { day: "numeric", month: "short" })
        .replace(/\.$/, "");
}

/** "2 de out., 09:35": for timelines that may span days. */
export function shortTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? i18n.t("common.unknownTime")
    : date.toLocaleString(locale(), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** The day of a timestamp as people say it: today, yesterday, else the date. */
export function dayLabel(value: string, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return i18n.t("common.unknownTime");
  const today = new Date(now);
  const startOf = (day: Date) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (days === 0) return i18n.t("common.today");
  if (days === 1) return i18n.t("common.yesterday");
  return date.toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A key that groups timestamps by local day. */
export function dayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** "14:32", in the researcher's locale. */
export function timeOfDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function duration(
  start: string | null,
  end: string | null,
  now = Date.now(),
): string {
  if (!start) return i18n.t("common.notRecorded");
  const seconds = Math.max(
    0,
    Math.round(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Elapsed time in the coarsest useful unit: "42s", "4 min", "1h 05". */
export function shortDuration(
  start: string | null,
  end: string | null,
  now = Date.now(),
): string {
  if (!start) return "";
  const seconds = Math.max(
    0,
    Math.round(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000),
  );
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t("common.minutes", { count: minutes });
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Elapsed time of a turn as m:ss, or h:mm:ss past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Spend in US dollars in the researcher's locale: "US$ 21,26" or "$21.26". */
export function formatCost(cost: number): string {
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cost);
}

/** Counts shortened for narrow places: "412 mil", "1,2 mi", "412K". */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat(locale(), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** What a tool call means to the reader, in the gerund; unknown tools keep their names. */
export function toolLabel(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return name in ptBR.tools ? i18n.t(`tools.${name as ToolKey}`) : name;
}

export function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function number(value: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 5 }).format(
    value,
  );
}

export function bytes(value: number): string {
  const short = (amount: number) =>
    new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(
      amount,
    );
  return value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${short(value / 1024)} KB`
      : value < 1024 ** 3
        ? `${short(value / 1024 ** 2)} MB`
        : `${short(value / 1024 ** 3)} GB`;
}

/** The body of a "## Title" section, matched loosely on any of the given words. */
export function markdownSection(
  markdown: string,
  words: string[],
): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => {
    const heading = /^##\s+(.+)/.exec(line)?.[1]?.toLowerCase();
    return (
      heading !== undefined && words.some((word) => heading.includes(word))
    );
  });
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text || null;
}

export function excerpt(text: string, max = 280): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
