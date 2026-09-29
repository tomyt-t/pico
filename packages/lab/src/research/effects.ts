import { randomUUID } from "node:crypto";
import type { MutationContext } from "@/lab/contracts";
import { LabError } from "@/lab/research/errors";
import type { EffectReceipts } from "@/lab/research/persistence";
import type { EffectRecord } from "@/lab/storage/operation-repository";
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** Durable identity reservation around effects which cannot share a SQLite transaction. */
export class EffectCoordinator {
  private readonly inflight = new Map<string, Promise<unknown>>();
  constructor(private readonly operations: EffectReceipts) {}
  async drain(): Promise<void> {
    while (this.inflight.size)
      await Promise.allSettled([...this.inflight.values()]);
  }
  isInflight(id: string): boolean {
    return this.inflight.has(id);
  }
  async run<T>(
    labId: string,
    operation: string,
    input: unknown,
    ctx: MutationContext,
    action: (id: string) => Promise<T>,
  ): Promise<T> {
    const reserved = this.operations.mutate(
      {
        labId,
        key: `effect:${ctx.key}`,
        operation,
        input: { input, actor: ctx.actor },
      },
      () =>
        this.operations.insertEffect({
          id: randomUUID(),
          labId,
          operation,
          resourceId: randomUUID(),
          state: "pending",
          result: null,
          error: null,
        }),
    );
    const effect = this.operations.getEffect(reserved.id);
    if (!effect) throw new Error("Effect receipt is missing");
    if (effect.state === "completed") return effect.result as T;
    if (effect.state === "failed")
      throw new LabError(
        "CONFLICT",
        effect.error ?? "Previous operation failed; use a new intent to retry",
      );
    const active = this.inflight.get(effect.id);
    if (active) return active as Promise<T>;
    const promise = Promise.resolve().then(async () => {
      try {
        const result = await action(effect.resourceId);
        this.complete(effect, result);
        return result;
      } catch (error) {
        // A published run can outlive a failed projection. Recovery must inspect it.
        this.operations.saveEffect({ ...effect, error: errorMessage(error) });
        throw error;
      } finally {
        this.inflight.delete(effect.id);
      }
    });
    this.inflight.set(effect.id, promise);
    return promise;
  }
  complete(effect: EffectRecord, result: unknown): void {
    this.operations.saveEffect({
      ...effect,
      state: "completed",
      result: JSON.parse(JSON.stringify(result ?? null)),
      error: null,
    });
  }
  fail(effect: EffectRecord, message: string): void {
    this.operations.saveEffect({ ...effect, state: "failed", error: message });
  }
}
