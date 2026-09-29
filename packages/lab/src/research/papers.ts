import type {
  MutationContext,
  NewPaper,
  Paper,
  WebToolName,
} from "@/lab/contracts";
import { paperSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import type { Laboratory } from "@/lab/research/laboratory";
import type { ResearchContext } from "@/lab/research/mutations";
import type { SourceAccess } from "@/lab/sources/source-access";
export function registerPaper(
  context: ResearchContext,
  labId: string,
  input: NewPaper,
  ctx: MutationContext,
): Paper {
  return context.mutate(labId, "registerPaper", input, ctx, () =>
    context.insert(labId, "paper", {
      ...context.meta(labId, ctx.actor),
      ...parse(paperSchema, input),
    }),
  );
}

export function createSourceOperations(
  lab: Laboratory,
  sources?: SourceAccess,
) {
  return {
    searchLiterature(query: string, signal?: AbortSignal) {
      if (!sources)
        throw new LabError("BAD_REQUEST", "Source access is not configured");
      return sources.search(query, signal);
    },
    async importPaper(
      labId: string,
      identifier: string,
      ctx: MutationContext,
      signal?: AbortSignal,
    ) {
      lab.getLab(labId);
      if (!sources)
        throw new LabError("BAD_REQUEST", "Source access is not configured");
      return lab.registerPaper(
        labId,
        await sources.import(identifier, signal),
        ctx,
      );
    },
    accessSource(
      labId: string,
      name: WebToolName,
      input: unknown,
      signal?: AbortSignal,
    ) {
      lab.getLab(labId);
      if (!sources)
        throw new LabError("BAD_REQUEST", "Source access is not configured");
      return sources.execute(labId, name, input, signal);
    },
  };
}
