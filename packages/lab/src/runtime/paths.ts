import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Application configuration never falls back to the user's global Pi profile. */
export function picoPaths(dataDir?: string, piAgentDir?: string) {
  const data = resolve(
    dataDir ??
      process.env.PICO_DATA_DIR ??
      join(homedir(), ".local/share/pico"),
  );
  return {
    dataDir: data,
    agentDir: resolve(
      piAgentDir ?? process.env.PICO_PI_AGENT_DIR ?? join(data, "pi"),
    ),
    runtimeDir: join(data, "runtime"),
  };
}
