import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface PicoPaths {
  /** Pico's own state: database and Claude Code profile. */
  dataDir: string;
  /** Root of the laboratory workspaces, one folder per lab. */
  labsDir: string;
  /** Pico's private Claude Code config: subscription login and transcripts. */
  claudeConfigDir: string;
  databasePath: string;
}

export type PathOverrides = Partial<
  Pick<PicoPaths, "dataDir" | "labsDir" | "claudeConfigDir">
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
  const claudeConfigDir = resolve(
    overrides.claudeConfigDir ??
      process.env.PICO_CLAUDE_CONFIG_DIR ??
      join(dataDir, "claude"),
  );
  return {
    dataDir,
    labsDir,
    claudeConfigDir,
    databasePath: join(dataDir, "pico.sqlite"),
  };
}

/** Creates the directories Pico owns. Never touches laboratory workspaces. */
export function preparePaths(paths: PicoPaths): void {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.labsDir, { recursive: true });
  mkdirSync(paths.claudeConfigDir, { recursive: true, mode: 0o700 });
}
