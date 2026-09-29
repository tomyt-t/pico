import { randomUUID } from "node:crypto";
import type { MutationContext, Turn } from "@/lab/contracts";
import { deliverCompletions } from "@/lab/pico/completion-events";
import { addMessage, readTurn, saveTurn } from "@/lab/pico/transcript";
import { runTurn, type TurnDependencies } from "@/lab/pico/turn";
import { LabError } from "@/lab/research/laboratory";
import type { OperationRepository } from "@/lab/storage/operation-repository";

export interface SessionDependencies
  extends Omit<TurnDependencies, "isClosing"> {
  operations: Pick<OperationRepository, "mutate">;
}

/** Owns the conversation queue; construction does not recover records or start timers. */
export class PicoSession {
  private readonly active = new Map<
    string,
    { turnId: string; controller: AbortController; promise: Promise<void> }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private started = false;
  private paused = false;
  private closed = false;
  private stopping = false;
  private closing?: Promise<void>;

  constructor(private readonly dependencies: SessionDependencies) {}

  start(): void {
    if (this.closed) throw new LabError("CONFLICT", "Conversation is closed");
    if (this.started) return;
    const repository = this.dependencies.conversations;
    for (const turn of repository.pendingTurns()) {
      if (turn.status === "running")
        saveTurn(repository, {
          ...turn,
          status: "interrupted",
          error:
            "Server restarted during this turn. Existing tool results are preserved; continue to resume.",
          endedAt: new Date().toISOString(),
        });
    }
    this.started = true;
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref();
    this.tick();
  }

  private assertActive(): void {
    if (!this.started || this.closed)
      throw new LabError("CONFLICT", "Conversation is not accepting work");
  }

  enqueue(labId: string, message: string, ctx: MutationContext): Turn {
    this.assertActive();
    if (!message.trim() || message.length > 50_000)
      throw new LabError(
        "BAD_REQUEST",
        "Message must contain 1 to 50,000 characters",
      );
    const { lab, conversations, operations } = this.dependencies;
    const conversation = lab.getConversation(labId);
    const turn = operations.mutate(
      { labId, key: ctx.key, operation: "chat", input: { message } },
      () => {
        const now = new Date().toISOString();
        const value = conversations.insertTurn({
          id: randomUUID(),
          labId,
          conversationId: conversation.id,
          status: "queued",
          trigger: "researcher",
          message: message.trim(),
          eventId: null,
          steps: 0,
          error: null,
          createdAt: now,
          updatedAt: now,
          endedAt: null,
        });
        addMessage(conversations, value, "user", value.message);
        return value;
      },
    );
    this.pump(labId);
    return this.getTurn(labId, turn.id);
  }

  stop(labId: string, id: string, ctx?: MutationContext): Turn {
    this.assertActive();
    const action = () => {
      const turn = this.getTurn(labId, id);
      const active = this.active.get(labId);
      if (active?.turnId === id) active.controller.abort();
      return ["queued", "running", "paused"].includes(turn.status)
        ? saveTurn(this.dependencies.conversations, {
            ...turn,
            status: "cancelled",
            endedAt: new Date().toISOString(),
            error:
              "Stopped by the researcher. Submitted runs continue independently.",
          })
        : turn;
    };
    return ctx
      ? this.dependencies.operations.mutate(
          { labId, key: ctx.key, operation: "stopTurn", input: { id } },
          action,
        )
      : action();
  }

  continue(labId: string, id: string, ctx?: MutationContext): Turn {
    this.assertActive();
    const action = () => {
      const turn = this.getTurn(labId, id);
      if (
        !["paused", "failed", "interrupted", "cancelled"].includes(turn.status)
      )
        throw new LabError(
          "CONFLICT",
          "Only paused, failed, interrupted or stopped turns can be continued",
        );
      if (this.active.has(labId))
        throw new LabError(
          "CONFLICT",
          "Wait for the active model operation to stop before continuing",
        );
      return saveTurn(this.dependencies.conversations, {
        ...turn,
        status: "queued",
        error: null,
        endedAt: null,
      });
    };
    const result = ctx
      ? this.dependencies.operations.mutate(
          { labId, key: ctx.key, operation: "continueTurn", input: { id } },
          action,
        )
      : action();
    this.pump(labId);
    return result;
  }

  getTurn(labId: string, id: string): Turn {
    return readTurn(
      this.dependencies.lab,
      this.dependencies.conversations,
      labId,
      id,
    );
  }

  tick(): void {
    if (!this.started || this.closed || this.paused) return;
    const laboratories = deliverCompletions(this.dependencies.conversations);
    for (const turn of this.dependencies.conversations.pendingTurns())
      laboratories.add(turn.labId);
    for (const labId of laboratories) this.pump(labId);
  }

  private pump(labId: string): void {
    if (!this.started || this.closed || this.paused || this.active.has(labId))
      return;
    const next = this.dependencies.conversations
      .pendingTurns(labId)
      .find((turn) => turn.status === "queued");
    if (!next) return;
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() =>
        runTurn(
          {
            ...this.dependencies,
            isClosing: () => this.stopping || this.closed,
          },
          next,
          controller.signal,
        ),
      )
      .finally(() => {
        this.active.delete(labId);
        this.pump(labId);
      });
    this.active.set(labId, { turnId: next.id, controller, promise });
  }

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    if (!this.closed) {
      this.paused = false;
      this.tick();
    }
  }
  get busy(): boolean {
    return this.active.size > 0;
  }

  async interrupt(): Promise<void> {
    this.stopping = true;
    this.paused = true;
    for (const item of this.active.values()) item.controller.abort();
    await Promise.all([...this.active.values()].map((item) => item.promise));
  }

  close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.closing ??= this.interrupt();
    return this.closing;
  }
}
