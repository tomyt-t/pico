import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface PicoPaths {
  /** Pico's own state: database, Pi profile and sessions. */
  dataDir: string;
  /** Root of the laboratory workspaces, one folder per lab. */
  labsDir: string;
  /** Pico's private Pi profile (auth, models, settings, web search). */
  agentDir: string;
  sessionsDir: string;
  databasePath: string;
}

export type PathOverrides = Partial<
  Pick<PicoPaths, "dataDir" | "labsDir" | "agentDir">
>;

export function picoPaths(overrides: PathOverrides = {}): PicoPaths {
  const dataDir = resolve(
    overrides.dataDir ??
      process.env.PICO_DATA_DIR ??
      join(homedir(), ".local", "share", "pico"),
  );
  const labsDir = resolve(
    overrides.labsDir ??
      process.env.PICO_LABS_DIR ??
      join(homedir(), "pico-labs"),
  );
  const agentDir = resolve(
    overrides.agentDir ?? process.env.PICO_PI_AGENT_DIR ?? join(dataDir, "pi"),
  );
  return {
    dataDir,
    labsDir,
    agentDir,
    sessionsDir: join(dataDir, "sessions"),
    databasePath: join(dataDir, "pico.sqlite"),
  };
}

export const defaultWebSearch = {
  provider: "exa",
  maxInlineContentChars: 40_000,
};

/** Creates the directories Pico owns. Never touches laboratory workspaces. */
export function preparePaths(paths: PicoPaths): void {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.labsDir, { recursive: true });
  mkdirSync(paths.agentDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.sessionsDir, { recursive: true });
  const webSearch = join(paths.agentDir, "web-search.json");
  if (!existsSync(webSearch))
    writeFileSync(webSearch, `${JSON.stringify(defaultWebSearch, null, 2)}\n`, {
      mode: 0o600,
    });
}
