import { existsSync } from "node:fs";
import { join } from "node:path";

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const identity = ["-c", "user.name=Pico", "-c", "user.email=pico@localhost"];

async function git(cwd: string, args: string[]): Promise<GitResult> {
  const process_ = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export function gitAvailable(): boolean {
  return Boolean(Bun.which("git"));
}

/** Initializes a repository for a workspace, with a first commit. Best effort. */
export async function ensureRepository(dir: string): Promise<void> {
  if (!gitAvailable()) return;
  if (!existsSync(join(dir, ".git"))) {
    const init = await git(dir, ["init", "-q"]);
    if (init.code !== 0) return;
  }
  await commitAll(dir, "Pico: laboratory created");
}

/** Commits every change in the workspace. Returns the current HEAD, or null without git. */
export async function commitAll(
  dir: string,
  message: string,
): Promise<string | null> {
  if (!gitAvailable() || !existsSync(join(dir, ".git"))) return null;
  const status = await git(dir, ["status", "--porcelain"]);
  if (status.code !== 0) return null;
  if (status.stdout) {
    await git(dir, ["add", "-A"]);
    await git(dir, [...identity, "commit", "-q", "-m", message]);
  }
  return head(dir);
}

export async function head(dir: string): Promise<string | null> {
  if (!gitAvailable()) return null;
  const result = await git(dir, ["rev-parse", "HEAD"]);
  return result.code === 0 ? result.stdout : null;
}
