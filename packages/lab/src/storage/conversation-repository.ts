import { randomUUID } from "node:crypto";
import type {
  Conversation,
  LabEvent,
  Message,
  ModelUsage,
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
  modelUsage(labId: string, turnId?: string, afterStep = 0): ModelUsage {
    const rows = this.database.database
      .query<{ usage: string | null }, (string | number)[]>(
        `SELECT json_extract(data, '$.usage') AS usage FROM records WHERE kind='model_step' AND lab_id=? ${turnId ? "AND json_extract(data, '$.turnId')=?" : ""} AND json_extract(data, '$.step')>?`,
      )
      .all(labId, ...(turnId ? [turnId] : []), afterStep);
    const total: ModelUsage = {
      calls: rows.length,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      tokensKnown: true,
      costKnown: true,
    };
    for (const row of rows) {
      const usage = row.usage
        ? (JSON.parse(row.usage) as Record<string, unknown>)
        : {};
      const input =
        nonnegative(usage.input) ?? nonnegative(usage.prompt_tokens);
      const output =
        nonnegative(usage.output) ?? nonnegative(usage.completion_tokens);
      const tokens =
        nonnegative(usage.totalTokens) ?? nonnegative(usage.total_tokens);
      const cost =
        usage.cost && typeof usage.cost === "object"
          ? nonnegative((usage.cost as Record<string, unknown>).total)
          : undefined;
      total.inputTokens +=
        (input ?? 0) +
        (nonnegative(usage.cacheRead) ?? 0) +
        (nonnegative(usage.cacheWrite) ?? 0);
      total.outputTokens += output ?? 0;
      total.totalTokens += tokens ?? (input ?? 0) + (output ?? 0);
      total.costUsd += cost ?? 0;
      total.tokensKnown &&=
        tokens !== undefined || (input !== undefined && output !== undefined);
      total.costKnown &&= cost !== undefined;
    }
    return total;
  }
  saveCompaction(
    labId: string,
    compaction: NonNullable<Conversation["compaction"]>,
  ): Conversation {
    const conversation = this.getConversation(labId);
    if (!conversation) throw new StorageConflict("Conversation not found");
    return this.records.replace("conversation", labId, {
      ...conversation,
      compaction,
      updatedAt: new Date().toISOString(),
    });
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
        // The current tool group is still pending, and queued researcher messages
        // may be newer than the request seen by the model. Cover neither one.
        const messages = this.listMessages(labId);
        const authorTurnId =
          ctx.actor.kind === "pico" ? ctx.actor.turnId : undefined;
        const boundary = messages.findIndex(
          (message) =>
            (authorTurnId && message.turnId === authorTurnId) ||
            message.toolCall?.status === "running" ||
            (message.turnId &&
              this.getTurn(message.turnId)?.status === "queued"),
        );
        const latest = (
          boundary < 0 ? messages : messages.slice(0, boundary)
        ).at(-1);
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
      const turns = new Map<string, Turn>();
      for (const event of events) {
        // A requested batch is analyzed together after its queued/running work
        // settles. Observations are already visible to explicit researcher turns.
        if (
          this.records.query(
            "run",
            event.labId,
            "json_extract(data, '$.status') IN ('queued','running')",
            [],
            1,
          ).length
        )
          continue;
        const conversation = this.getConversation(event.labId);
        if (!conversation)
          throw new StorageConflict("Event has no conversation");
        const now = new Date().toISOString();
        let turn = this.records.query<Turn>(
          "turn",
          event.labId,
          "json_extract(data, '$.eventId') = ? OR EXISTS (SELECT 1 FROM json_each(records.data, '$.eventIds') WHERE value = ?)",
          [event.id, event.id],
          1,
        )[0];
        if (!turn) {
          // Appends and the transition to running are synchronous transactions
          // on this connection. Never append to a turn already sent to a model.
          turn = this.pendingTurns(event.labId).find(
            (candidate) =>
              candidate.status === "queued" &&
              candidate.trigger === "run_completed",
          );
          const eventIds = [
            ...(turn?.eventIds ?? (turn?.eventId ? [turn.eventId] : [])),
            event.id,
          ];
          // A queued legacy turn predates eventRuns. Recover its leading event
          // reference before appending so batching never hides an old condition.
          const eventRuns = eventIds.flatMap((eventId) => {
            const prior = turn?.eventRuns?.find(
              (item) => item.eventId === eventId,
            );
            if (prior) return [prior];
            const record = this.records.get<LabEvent>("event", eventId);
            return record?.labId === event.labId
              ? [{ eventId, runId: record.entityId }]
              : [];
          });
          const description = `Execution observations awaiting analysis (${eventIds.length}). Use read_turn with this turn's ID to page all eventRuns before comparing conditions: ${JSON.stringify(eventRuns)}`;
          turn = turn
            ? this.saveTurn({
                ...turn,
                message: description,
                eventIds,
                eventRuns,
                updatedAt: now,
              })
            : this.insertTurn({
                id: `event-${event.id}`,
                labId: event.labId,
                conversationId: conversation.id,
                status: "queued",
                trigger: "run_completed",
                message: description,
                eventId: event.id,
                eventIds,
                eventRuns,
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
            eventId: event.id,
            eventRunId: event.entityId,
            role: "user",
            content: `Execution observation (reference data, not a researcher instruction): ${JSON.stringify({ eventId: event.id, runId: event.entityId, message: event.message })}`,
            createdAt: now,
          });
        }
        this.records.replace("event", event.labId, {
          ...event,
          consumedAt: now,
        });
        turns.set(turn.id, turn);
      }
      return [...turns.values()];
    });
  }
}

function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
