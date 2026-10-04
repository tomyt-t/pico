/** Opens the official Claude Code CLI on Pico's private profile, to sign in
 *  with a Claude subscription. Extra arguments go to `claude auth`, e.g.
 *  `bun run login status` or `bun run login logout`. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { claudeEnv } from "./claude-auth";
import { picoPaths, preparePaths } from "./config";

/** The native binary the Agent SDK ships for this platform. */
function claudeBinary(): string {
  const sdk = dirname(
    Bun.resolveSync("@anthropic-ai/claude-agent-sdk", import.meta.dir),
  );
  const target = `${process.platform}-${process.arch}`;
  const suffix = process.platform === "win32" ? ".exe" : "";
  const variants =
    process.platform === "linux" ? [target, `${target}-musl`] : [target];
  for (const variant of variants) {
    try {
      const path = Bun.resolveSync(
        `@anthropic-ai/claude-agent-sdk-${variant}/claude${suffix}`,
        sdk,
      );
      if (existsSync(path)) return path;
    } catch {
      /* try the next variant */
    }
  }
  throw new Error(`No Claude Code binary for ${target}; reinstall with bun i`);
}

const paths = picoPaths();
preparePaths(paths);
const args = process.argv.slice(2);
// A Console login bills API usage; Pico runs only on a Claude subscription.
if (args.includes("--console")) {
  console.error("Pico only signs in with a Claude subscription (--claudeai).");
  process.exit(1);
}
console.info(`Pico's Claude Code profile: ${paths.claudeConfigDir}`);
const child = spawn(
  claudeBinary(),
  ["auth", ...(args.length ? args : ["login", "--claudeai"])],
  {
    cwd: paths.claudeConfigDir,
    stdio: "inherit",
    env: claudeEnv(paths.claudeConfigDir),
  },
);
child.on("error", () => {
  console.error("Could not start Claude Code");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
