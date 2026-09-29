import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparePiProfile } from "@/lab/models/pi-profile";
import { backupLaboratory } from "@/lab/runtime/backup";
import { picoPaths } from "@/lab/runtime/paths";
import { defaultWebConfig } from "@/lab/sources/web-config";
import { ResearchBackup } from "@/lab/storage/backup";

export { picoPaths };
export function restoreLaboratory(source: string, destination: string): void {
  ResearchBackup.restore(source, destination);
}
export function createBackup(dataDir: string, destination: string) {
  if (!existsSync(join(dataDir, "pico.sqlite")))
    throw new Error(`No laboratory database at ${dataDir}`);
  return backupLaboratory(dataDir, destination, {
    key: randomUUID(),
    actor: { kind: "researcher" },
  });
}
export function preparePiCli(dataDir?: string, piAgentDir?: string) {
  const { agentDir } = picoPaths(dataDir, piAgentDir);
  preparePiProfile(agentDir, defaultWebConfig);
  const cwd = join(agentDir, "workspace");
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const cli = join(
    dirname(
      fileURLToPath(
        import.meta.resolve("@earendil-works/pi-coding-agent/package.json"),
      ),
    ),
    "dist/cli.js",
  );
  return { agentDir, cwd, cli };
}
