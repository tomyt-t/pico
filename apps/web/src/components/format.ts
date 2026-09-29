import { currentLanguage, i18n } from "@/web/components/i18n";
import { ptBR } from "@/web/components/locales/pt-BR";

type StatusKey = keyof typeof ptBR.status;
type AuthorKey = keyof typeof ptBR.author;

export function locale(): string {
  return currentLanguage();
}

export function statusLabel(value: string): string {
  return value in ptBR.status
    ? i18n.t(`status.${value as StatusKey}`)
    : titleCase(value);
}

export function author(kind: string): string {
  return kind in ptBR.author ? i18n.t(`author.${kind as AuthorKey}`) : kind;
}

export function timestamp(value: string | null | undefined): string {
  if (!value) return i18n.t("common.notRecorded");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? i18n.t("common.unknownTime")
    : date.toLocaleString(locale(), {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function relativeTime(value: string, now = Date.now()): string {
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

export function shortId(value: string): string {
  return value.slice(0, 8);
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
  return value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${number(value / 1024)} KB`
      : `${number(value / 1024 ** 2)} MB`;
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t("common.genericError");
}
