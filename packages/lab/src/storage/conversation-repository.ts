import { randomUUID } from "node:crypto";
import type {
  Conversation,
  LabEvent,
  Message,
  MutationContext,
  Turn,
} from "@/lab/contracts";
import type { DatabaseConnection } from "@/lab/storage/database";
import { StorageConflict } from "@/lab/storage/errors";
import type { OperationRepository } from "@/lab/storage/operation-repository";
import type { Records } from "@/lab/storage/records";
export class ConversationRepository {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly records: Records,
    private readonly operations: OperationRepository,
  ) {}
  transaction<T>(action: () => T): T {
    return this.database.transaction(action);
  }
  getConversation(labId: string): Conversation | undefined {
    return this.records.query<Conversation>(
      "conversation",
      labId,
      "1",
      [],
      1,
    )[0];
  }
  listConversations(): Conversation[] {
    return this.records.list("conversation");
  }
  createConversation(record: Conversation): Conversation {
    return this.records.insert("conversation", record.labId, record);
  }
  getTurn(id: string): Turn | undefined {
    return this.records.get("turn", id);
  }
  listTurns(labId?: string): Turn[] {
    return this.records.list("turn", labId);
  }
  pendingTurns(labId?: string): Turn[] {
    return this.records.query(
      "turn",
      labId,
      "json_extract(data, '$.status') IN ('queued','running')",
    );
  }
  activeTurn(labId: string): Turn | null {
    const active = this.pendingTurns(labId);
    return active.find((t) => t.status === "running") ?? active[0] ?? null;
  }
  insertTurn(turn: Turn): Turn {
    return this.records.insert("turn", turn.labId, turn);
  }
  saveTurn(turn: Turn): Turn {
    return this.records.replace("turn", turn.labId, turn);
  }
  listMessages(
    labId: string,
    options?: { limit?: number; before?: string },
  ): Message[] {
    // Preserve order for replay; bound public history explicitly at its caller.
    if (!options) return this.records.list("message", labId);
    const limit = Math.min(1000, Math.max(1, options.limit ?? 200));
    const rows = this.database.database
      .query<{ data: string }, (string | number)[]>(
        `SELECT data FROM records WHERE kind='message' AND lab_id=? ${options.before ? "AND rowid < COALESCE((SELECT rowid FROM records WHERE id=? AND lab_id=?),0)" : ""} ORDER BY created_at DESC,rowid DESC LIMIT ?`,
      )
      .all(labId, ...(options.before ? [options.before, labId] : []), limit);
    return rows.reverse().map((row) => JSON.parse(row.data) as Message);
  }
  messagesForTurns(labId: string, turnIds: string[]): Message[] {
    if (!turnIds.length) return [];
    return this.records.query(
      "message",
      labId,
      `json_extract(data, '$.turnId') IN (${turnIds.map(() => "?").join(",")})`,
      turnIds,
    );
  }
  modelStepsForTurns<T>(labId: string, turnIds: string[]): T[] {
    if (!turnIds.length) return [];
    return this.records.query(
      "model_step",
      labId,
      `json_extract(data, '$.turnId') IN (${turnIds.map(() => "?").join(",")})`,
      turnIds,
    );
  }
  insertMessage(message: Message): Message {
    return this.records.insert("message", message.labId, message);
  }
  saveMessage(message: Message): Message {
    return this.records.replace("message", message.labId, message);
  }
  listModelSteps<T>(labId: string): T[] {
    return this.records.list("model_step", labId);
  }
  insertModelStep<T extends { id: string; labId: string }>(step: T): T {
    return this.records.insert("model_step", step.labId, step);
  }
  updateSummary(
    labId: string,
    summary: string,
    ctx: MutationContext,
  ): Conversation {
    return this.operations.mutate(
      { labId, key: ctx.key, operation: "updateSummary", input: { summary } },
      () => {
        const conversation = this.getConversation(labId);
        if (!conversation) throw new StorageConflict("Conversation not found");
        const latest = this.listMessages(labId, { limit: 1 }).at(-1);
        return this.records.replace("conversation", labId, {
          ...conversation,
          summary,
          summaryThroughMessageId: latest?.id ?? null,
          updatedAt: new Date().toISOString(),
        });
      },
    );
  }
  /** Event delivery and turn/message creation commit together on the shared connection. */
  consumeCompletionEvents(): Turn[] {
    return this.transaction(() => {
      const events = this.records.query<LabEvent>(
        "event",
        undefined,
        "json_extract(data, '$.kind') = 'run_completed' AND json_extract(data, '$.consumedAt') IS NULL",
      );
      const turns: Turn[] = [];
      for (const event of events) {
        const conversation = this.getConversation(event.labId);
        if (!conversation)
          throw new StorageConflict("Event has no conversation");
        const now = new Date().toISOString();
        let turn = this.getTurn(`event-${event.id}`);
        if (!turn) {
          turn = this.insertTurn({
            id: `event-${event.id}`,
            labId: event.labId,
            conversationId: conversation.id,
            status: "queued",
            trigger: "run_completed",
            message: event.message,
            eventId: event.id,
            steps: 0,
            error: null,
            createdAt: now,
            updatedAt: now,
            endedAt: null,
          });
          this.insertMessage({
            id: randomUUID(),
            labId: event.labId,
            conversationId: conversation.id,
            turnId: turn.id,
            role: "system",
            content: `Execution completed: ${event.message}. Run ID: ${event.entityId}. Inspect real outputs and analyze existing evidence; do not launch a new experiment automatically.`,
            createdAt: now,
          });
        }
        this.records.replace("event", event.labId, {
          ...event,
          consumedAt: now,
        });
        turns.push(turn);
      }
      return turns;
    });
  }
}
