import { ResearchBackup } from "@/lab/storage/backup";
import { ConversationRepository } from "@/lab/storage/conversation-repository";
import { DatabaseConnection } from "@/lab/storage/database";
import { OperationRepository } from "@/lab/storage/operation-repository";
import { Records } from "@/lab/storage/records";
import { ResearchFiles } from "@/lab/storage/research-files";
import { ResearchRepository } from "@/lab/storage/research-repository";

export { StorageConflict } from "@/lab/storage/errors";
export function createStorage(dataDir: string) {
  const database = new DatabaseConnection(dataDir);
  const records = new Records(database);
  const operations = new OperationRepository(database, records);
  return {
    dataDir: database.dataDir,
    research: new ResearchRepository(records),
    conversation: new ConversationRepository(database, records, operations),
    operations,
    files: new ResearchFiles(database.dataDir),
    backup: new ResearchBackup(database),
    close: () => database.close(),
  };
}
export type Storage = ReturnType<typeof createStorage>;
