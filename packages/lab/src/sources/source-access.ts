import { importLiterature, searchLiterature } from "@/lab/sources/crossref";
import { createWebAccess } from "@/lab/sources/web-client";
import type { WebAccess } from "@/lab/sources/web-protocol";

export type { WebAccess, WebToolName } from "@/lab/sources/web-protocol";

export interface SourceAccess extends WebAccess {
  search(
    query: string,
    signal?: AbortSignal,
  ): ReturnType<typeof searchLiterature>;
  import(
    identifier: string,
    signal?: AbortSignal,
  ): ReturnType<typeof importLiterature>;
}

export function createSourceAccess(options: {
  agentDir: string;
  runtimeDir: string;
  web?: WebAccess;
}): SourceAccess {
  const web = options.web ?? createWebAccess(options);
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  function track<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (controller.signal.aborted)
      return Promise.reject(new Error("Source access is closed"));
    const combined = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;
    const promise = Promise.resolve()
      .then(() => operation(combined))
      .finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  }
  return {
    search: (query, signal) =>
      track((abort) => searchLiterature(query, abort), signal),
    import: (identifier, signal) =>
      track((abort) => importLiterature(identifier, abort), signal),
    execute: (labId, name, input, signal) =>
      track((abort) => web.execute(labId, name, input, abort), signal),
    close() {
      controller.abort();
      closing ??= Promise.allSettled([web.close(), ...pending]).then(
        () => undefined,
      );
      return closing;
    },
  };
}
