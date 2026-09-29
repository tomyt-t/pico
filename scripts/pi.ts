import { spawn } from "node:child_process";
import { preparePiCli } from "@pico/lab/administration";

const { agentDir, cwd, cli } = preparePiCli();
console.info(`Pico's isolated Pi profile: ${agentDir}`);
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
    cwd,
    stdio: "inherit",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  },
);
child.on("error", () => {
  console.error("Could not start Pico's local Pi CLI");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
