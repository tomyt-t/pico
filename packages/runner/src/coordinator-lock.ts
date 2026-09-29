import { Database } from "bun:sqlite";
import { join } from "node:path";
import { RunnerError } from "@/runner/files";

/** An OS-released lock, never part of a research archive or backup. */
export function acquireCoordinatorLock(root: string): () => void {
  const lock = new Database(join(root, ".pico-runner-owner.sqlite"), {
    create: true,
  });
  try {
    lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new RunnerError(
      "Another execution coordinator owns this data directory",
      "conflict",
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      lock.exec("ROLLBACK");
    } finally {
      lock.close();
    }
  };
}
