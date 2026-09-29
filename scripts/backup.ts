import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createBackup, restoreLaboratory } from "@pico/lab/administration";

const [operation, first, second] = Bun.argv.slice(2);
if (operation === "create" && first && !second) {
  const dataDir = resolve(
    process.env.PICO_DATA_DIR || join(homedir(), ".local", "share", "pico"),
  );
  if (!(await Bun.file(join(dataDir, "pico.sqlite")).exists()))
    throw new Error(`No laboratory database at ${dataDir}`);
  console.info((await createBackup(dataDir, first)).path);
} else if (operation === "restore" && first && second) {
  restoreLaboratory(first, second);
  console.info(`Restored research at ${resolve(second)}`);
} else {
  console.error(
    "Usage: bun scripts/backup.ts create <new-backup-directory> | restore <backup-directory> <new-data-directory>",
  );
  process.exitCode = 1;
}
