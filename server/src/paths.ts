import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/** Resolves a path the way a shell user expects: "~" is home, relative paths hang off the laboratory. */
export function resolveUserPath(base: string, input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : resolve(base, trimmed);
}
