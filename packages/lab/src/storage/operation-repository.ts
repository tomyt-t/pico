import type { Json } from "@/lab/contracts";
import { canonicalJson, hash } from "@/lab/storage/canonical-json";
import type { DatabaseConnection } from "@/lab/storage/database";
import { StorageConflict } from "@/lab/storage/errors";
import type { Records } from "@/lab/storage/records";
export interface Mutation {
  labId: string;
  key: string;
  operation: string;
  input: unknown;
}
export interface EffectRecord {
  id: string;
  labId: string;
  operation: string;
  resourceId: string;
  state: "pending" | "completed" | "failed";
  result: Json | null;
  error: string | null;
}
export class OperationRepository {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly records: Records,
  ) {}
  transaction<T>(operation: () => T): T {
    return this.connection.transaction(operation);
  }
  /** A receipt and all its scientific writes commit or roll back together. */
  mutate<T>(mutation: Mutation, operation: () => T): T {
    if (!mutation.key.trim() || mutation.key.length > 300) {
      throw new StorageConflict(
        "A non-empty idempotency key of at most 300 characters is required",
      );
    }
    const fingerprint = hash(Buffer.from(canonicalJson(mutation.input)));
    return this.connection.transaction(() => {
      const receipt = this.connection.database
        .query<
          {
            operation: string;
            fingerprint: string;
            result: string;
          },
          [string, string]
        >(
          "SELECT operation,fingerprint,result FROM mutation_receipts WHERE lab_id = ? AND key = ?",
        )
        .get(mutation.labId, mutation.key);
      if (receipt) {
        if (
          receipt.operation !== mutation.operation ||
          receipt.fingerprint !== fingerprint
        ) {
          throw new StorageConflict(
            "Idempotency key was already used with different arguments",
          );
        }
        return JSON.parse(receipt.result) as T;
      }
      const result = operation();
      if (result instanceof Promise)
        throw new Error("Storage mutations must be synchronous");
      this.connection.database
        .query(
          "INSERT INTO mutation_receipts(lab_id,key,operation,fingerprint,result,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          mutation.labId,
          mutation.key,
          mutation.operation,
          fingerprint,
          JSON.stringify(result ?? null),
          new Date().toISOString(),
        );
      return result;
    });
  }

  getEffect(id: string): EffectRecord | undefined {
    return this.records.get("effect", id);
  }
  insertEffect(effect: EffectRecord): EffectRecord {
    return this.records.insert("effect", effect.labId, effect);
  }
  saveEffect(effect: EffectRecord): EffectRecord {
    return this.records.replace("effect", effect.labId, effect);
  }
  listEffects(labId?: string): EffectRecord[] {
    return this.records.list("effect", labId);
  }
  pendingEffects(): EffectRecord[] {
    return this.records.query(
      "effect",
      undefined,
      "json_extract(data, '$.state') = 'pending'",
    );
  }
}
