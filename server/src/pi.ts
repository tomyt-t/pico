/** Opens Pi's own CLI on Pico's private profile, for /login and model setup. */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { picoPaths, preparePaths } from "./config";

const paths = picoPaths();
preparePaths(paths);
const workspace = join(paths.agentDir, "workspace");
mkdirSync(workspace, { recursive: true });
const cli = join(
  dirname(Bun.resolveSync("@earendil-works/pi-coding-agent", import.meta.dir)),
  "bundle",
  "cli.js",
);
console.info(`Pico's Pi profile: ${paths.agentDir}`);
const child = spawn(
  process.execPath,
  [
    cli,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-session",
    ...process.argv.slice(2),
  ],
  {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, PI_CODING_AGENT_DIR: paths.agentDir },
  },
);
child.on("error", () => {
  console.error("Could not start Pi");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
