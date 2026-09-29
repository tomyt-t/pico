import type {
  Conclusion,
  Experiment,
  Hypothesis,
  MutationContext,
  NewResult,
  Result,
  ResultPatch,
  Run,
} from "@/lab/contracts";
import { resultPatchSchema, resultSchema } from "@/lab/contracts";
import { LabError, parse } from "@/lab/research/errors";
import { validateObservationReferences } from "@/lab/research/evidence";
import type { ResearchContext } from "@/lab/research/mutations";
import { terminal } from "@/lab/research/run-state";
export function recordResult(
  context: ResearchContext,
  labId: string,
  input: NewResult,
  ctx: MutationContext,
): Result {
  return context.mutate(labId, "recordResult", input, ctx, () => {
    const fields = parse(resultSchema, input);
    context.getRecord<Experiment>(labId, "experiment", fields.experimentId);
    for (const runId of fields.runIds) {
      const run = context.getRecord<Run>(labId, "run", runId);
      if (run.experimentId !== fields.experimentId)
        throw new LabError(
          "BAD_REQUEST",
          "Results must reference executions of the same experiment",
        );
      if (!terminal.has(run.status))
        throw new LabError(
          "BAD_REQUEST",
          "Wait for execution to finish before recording a result",
        );
    }
    validateObservationReferences(
      context,
      labId,
      fields.runIds,
      fields.evidence ?? [],
    );
    return context.insert(labId, "result", {
      ...context.meta(labId, ctx.actor),
      ...fields,
      evidenceVersion: 1,
      evidence: fields.evidence ?? [],
    });
  });
}
export function reviseResult(
  context: ResearchContext,
  labId: string,
  id: string,
  patch: ResultPatch,
  ctx: MutationContext,
  reason = "Revised result analysis while preserving run evidence",
): Result {
  return context.mutate(
    labId,
    "reviseResult",
    { id, patch, reason },
    ctx,
    () => {
      const current = context.getRecord<Result>(labId, "result", id);
      const fields = parse(resultPatchSchema, patch);
      if (fields.evidence !== undefined)
        validateObservationReferences(
          context,
          labId,
          current.runIds,
          fields.evidence,
        );
      const revised = context.revise(
        "result",
        current,
        {
          ...fields,
          ...(fields.evidence !== undefined
            ? { evidenceVersion: 1 as const }
            : {}),
        },
        ctx.actor,
        reason,
      );
      // All dependent flags and the corrected result commit with the same receipt.
      // Preserve the original resultRevisions: this is a request for review, not
      // a new scientific assessment made by the system.
      for (const kind of ["hypothesis", "conclusion"] as const) {
        for (const record of context.repo.list<Hypothesis | Conclusion>(
          kind,
          labId,
        )) {
          if (record.resultIds.includes(id) && !record.needsReview) {
            context.revise(
              kind,
              record,
              { needsReview: true },
              { kind: "system" },
              `Result ${id} changed from revision ${current.revision} to ${revised.revision}; review the recorded assessment`,
            );
          }
        }
      }
      return revised;
    },
  );
}
