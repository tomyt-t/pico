import { AsyncLocalStorage } from "node:async_hooks";

export class RuntimeUnavailable extends Error {
  readonly code = "UNAVAILABLE";
}

/** Checks captured capabilities on invocation and drains the entire admitted promise. */
export class Admission {
  private readonly pending = new Map<Promise<unknown>, Scope>();
  private readonly current = new AsyncLocalStorage<Scope>();
  private accepting = false;
  private sealed = false;
  get inOperation(): boolean {
    return this.current.getStore()?.active === true;
  }
  open(): void {
    this.accepting = true;
  }
  pause(): void {
    this.accepting = false;
  }
  seal(): void {
    this.sealed = true;
    this.accepting = false;
  }
  assertOpen(): void {
    if (this.sealed || (!this.accepting && !this.current.getStore()?.active))
      throw new RuntimeUnavailable(
        "Pico is not accepting work during startup, maintenance or shutdown",
      );
  }
  run<T>(operation: () => T): T {
    this.assertOpen();
    const scope: Scope = { active: true, parent: this.current.getStore() };
    try {
      const result = this.current.run(scope, operation);
      if (result instanceof Promise) {
        const pending = result.finally(() => {
          scope.active = false;
          this.pending.delete(pending);
        });
        this.pending.set(pending, scope);
        return pending as T;
      }
      scope.active = false;
      return result;
    } catch (error) {
      scope.active = false;
      throw error;
    }
  }
  async drain(): Promise<void> {
    // A backup invoked by an admitted request cannot wait for its own caller.
    const ancestors = new Set<Scope>();
    for (let scope = this.current.getStore(); scope; scope = scope.parent)
      ancestors.add(scope);
    while (true) {
      const pending = [...this.pending]
        .filter(([, scope]) => !ancestors.has(scope))
        .map(([promise]) => promise);
      if (!pending.length) return;
      await Promise.allSettled(pending);
    }
  }
}

interface Scope {
  active: boolean;
  parent?: Scope;
}
