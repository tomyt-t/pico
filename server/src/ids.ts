import { randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}
