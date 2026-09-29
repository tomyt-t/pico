import type { LabRuntime } from "@pico/lab";
import type {
  NewConclusion,
  NewHypothesis,
  NewQuestion,
  NewResult,
  ResultPatch,
} from "@pico/lab/contracts";
import { z } from "zod";
import type { RequestContext } from "@/server/http/request-context";
import { json } from "@/server/http/responses";
export function researchRoutes(
  {
    resource,
    labId,
    id,
    action,
    parts,
    method,
    body,
    mutation,
  }: RequestContext,
  runtime: LabRuntime,
): Response | undefined {
  const lab = runtime.research;
  const { reason, ...patch } = body;
  const explanation = typeof reason === "string" ? reason : undefined;
  if (resource === "questions") {
    if (!id && method === "POST")
      return json(
        lab.createQuestion(labId, body as unknown as NewQuestion, mutation),
        201,
      );
    if (id && method === "PATCH")
      return json(
        lab.reviseQuestion(
          labId,
          id,
          patch as Partial<NewQuestion>,
          mutation,
          explanation,
        ),
      );
  }
  if (resource === "hypotheses") {
    if (!id && method === "POST")
      return json(
        lab.createHypothesis(labId, body as unknown as NewHypothesis, mutation),
        201,
      );
    if (id && method === "PATCH")
      return json(
        lab.reviseHypothesis(
          labId,
          id,
          patch as Partial<NewHypothesis>,
          mutation,
          explanation,
        ),
      );
  }
  if (resource === "results") {
    if (!id && method === "POST")
      return json(
        lab.recordResult(labId, body as unknown as NewResult, mutation),
        201,
      );
    if (id && method === "PATCH")
      return json(
        lab.reviseResult(
          labId,
          id,
          patch as ResultPatch,
          mutation,
          explanation,
        ),
      );
  }
  if (resource === "conclusions") {
    if (!id && method === "POST")
      return json(
        lab.recordConclusion(labId, body as unknown as NewConclusion, mutation),
        201,
      );
    if (id && method === "PATCH")
      return json(
        lab.reviseConclusion(
          labId,
          id,
          patch as Partial<NewConclusion>,
          mutation,
          explanation,
        ),
      );
  }
  if (
    resource === "records" &&
    id &&
    action &&
    parts[6] === "history" &&
    method === "GET"
  ) {
    const kind = z
      .enum([
        "question",
        "hypothesis",
        "experiment",
        "dataset",
        "paper",
        "run",
        "result",
        "conclusion",
      ])
      .parse(id);
    lab.getRecord(labId, kind, action);
    return json(lab.history(labId, action));
  }
}
