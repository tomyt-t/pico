import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { importDatasetDirectory } from "@pico/lab/administration";
import type { DatasetDirectoryRegistration } from "@pico/lab/contracts";

const [labId, directory, name, version, source, license, ...flags] =
  Bun.argv.slice(2);
if (
  !labId ||
  !directory ||
  !name ||
  !version ||
  !source ||
  !license ||
  flags.length % 2 !== 0
) {
  console.error(
    "Usage: bun scripts/import-dataset.ts <lab-id> <local-directory> <name> <version> <source> <license> [--max-file-mib N] [--max-total-mib N] [--max-files N] [--intent KEY]",
  );
  process.exitCode = 1;
} else {
  const limits: NonNullable<DatasetDirectoryRegistration["limits"]> = {};
  let intent: string = randomUUID();
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (flag === "--intent" && value) {
      intent = value;
      continue;
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Import limits must be positive integers");
    if (flag === "--max-file-mib") limits.maxFileBytes = number * 1024 * 1024;
    else if (flag === "--max-total-mib")
      limits.maxTreeBytes = number * 1024 * 1024;
    else if (flag === "--max-files") limits.maxFiles = number;
    else throw new Error(`Unknown option: ${flag}`);
  }
  const dataDir = resolve(
    process.env.PICO_DATA_DIR || join(homedir(), ".local", "share", "pico"),
  );
  if (!(await Bun.file(join(dataDir, "pico.sqlite")).exists()))
    throw new Error(`No laboratory database at ${dataDir}`);
  const dataset = await importDatasetDirectory(
    dataDir,
    labId,
    {
      directory: resolve(directory),
      name,
      version,
      source,
      license,
      limits,
    },
    { key: intent, actor: { kind: "researcher" } },
  );
  console.info(
    JSON.stringify(
      {
        id: dataset.id,
        name: dataset.name,
        version: dataset.version,
        files: dataset.files.length,
        bytes: dataset.files.reduce((sum, file) => sum + file.size, 0),
        manifestHash: dataset.manifestHash,
        intent,
      },
      null,
      2,
    ),
  );
}
