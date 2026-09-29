export function timestamp(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
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
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(
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
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
