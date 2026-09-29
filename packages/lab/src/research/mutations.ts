import { randomUUID } from "node:crypto";
import type {
  Actor,
  JsonObject,
  Lab,
  LabEvent,
  MutationContext,
  RecordMeta,
} from "@/lab/contracts";
import { actorSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import type { LaboratoryPersistence } from "@/lab/research/persistence";
import type {
  ResearchRecord,
  ScientificKind,
} from "@/lab/storage/research-repository";

type ScientificRecord = ResearchRecord;

export type { ScientificKind };
export class ResearchContext {
  readonly repo;
  readonly conversations: LaboratoryPersistence["conversation"];
  readonly operations;
  constructor(storage: LaboratoryPersistence) {
    this.repo = storage.research;
    this.conversations = storage.conversation;
    this.operations = storage.operations;
  }
  getLab(id: string): Lab {
    const lab = this.repo.get<Lab>("lab", id);
    if (!lab) throw new LabError("NOT_FOUND", "Laboratory not found");
    return lab;
  }
  getRecord<T extends ScientificRecord>(
    labId: string,
    kind: ScientificKind,
    id: string,
  ): T {
    this.getLab(labId);
    const record = this.repo.get<T>(kind, id);
    if (!record || record.labId !== labId)
      throw new LabError("NOT_FOUND", `${kind} not found in this laboratory`);
    return record;
  }
  mutate<T>(
    labId: string,
    operation: string,
    input: unknown,
    ctx: MutationContext,
    action: () => T,
  ): T {
    this.getLab(labId);
    parse(actorSchema, ctx.actor);
    return this.operations.mutate(
      { labId, key: ctx.key, operation, input: { input, actor: ctx.actor } },
      action,
    );
  }
  meta(labId: string, author: Actor, id: string = randomUUID()): RecordMeta {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id))
      throw new LabError("BAD_REQUEST", "Invalid record identifier");
    const now = timestamp();
    return { id, labId, author, revision: 1, createdAt: now, updatedAt: now };
  }
  insert<T extends ScientificRecord>(
    labId: string,
    kind: ScientificKind,
    record: T,
  ): T {
    this.repo.insert(kind, labId, record);
    this.event(labId, `${kind}_created`, kind, record.id, `Recorded ${kind}`);
    return record;
  }
  revise<T extends ScientificRecord>(
    kind: ScientificKind,
    current: T,
    fields: Partial<T>,
    author: Actor,
    reason: string,
  ): T {
    if (!reason.trim())
      throw new LabError(
        "BAD_REQUEST",
        "A reason is required for a scientific revision",
      );
    const revised = {
      ...current,
      ...fields,
      revision: current.revision + 1,
      updatedAt: timestamp(),
    };
    this.repo.revise(kind, current.labId, revised, { author, reason });
    this.event(current.labId, `${kind}_revised`, kind, current.id, reason);
    return revised;
  }
  event(
    labId: string,
    kind: string,
    entityType: string,
    entityId: string,
    message: string,
    payload: JsonObject = {},
  ): void {
    this.repo.insert<LabEvent>("event", labId, {
      id: randomUUID(),
      labId,
      kind,
      entityType,
      entityId,
      message,
      payload,
      createdAt: timestamp(),
      consumedAt: null,
    });
  }
}
export function timestamp(): string {
  return new Date().toISOString();
}

export function scientificFields<T extends RecordMeta>(
  record: T,
): Omit<T, keyof RecordMeta> {
  const {
    id: _id,
    labId: _labId,
    author: _author,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = record;
  return fields;
}
