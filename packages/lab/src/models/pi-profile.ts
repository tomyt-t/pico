import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function preparePiProfile(
  agentDir: string,
  webConfig: Record<string, unknown>,
) {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      join(agentDir, "web-search.json"),
      `${JSON.stringify(webConfig, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
