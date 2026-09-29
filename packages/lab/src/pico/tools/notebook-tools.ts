import { z } from "zod";
import { jsonPage, pageFields } from "@/lab/pico/tools/output";
import type { ToolScope } from "@/lab/pico/tools/tool-definition";

const id = z.string().min(1);

export function registerNotebookTools({
  research,
  labId,
  tool,
}: ToolScope): void {
  tool(
    "read_turn",
    "Read every completion event/run reference (default section eventRuns), or turn metadata/observed model usage (section turn). Byte pages require nextOffset and fingerprint. eventRuns is fixed once analysis starts; active turn metadata may change.",
    z
      .object({
        id,
        section: z.enum(["eventRuns", "turn"]).default("eventRuns"),
        ...pageFields,
      })
      .strict(),
    (input) => {
      const turn = research
        .conversationView(labId)
        .turns.find((item) => item.id === input.id);
      if (!turn) throw new Error("Turn not found in this laboratory");
      return jsonPage(
        input.section === "eventRuns" ? (turn.eventRuns ?? []) : turn,
        input.offset,
        input.maxBytes,
        input.fingerprint,
      );
    },
  );
  tool(
    "read_history",
    "Read preserved conversation messages; pass before for older messages. Large batches return JSON text pages; keep before/limit fixed and continue nextOffset until null before changing the message cursor.",
    z
      .object({
        before: id.optional(),
        limit: z.number().int().min(1).max(50).default(20),
        ...pageFields,
      })
      .strict(),
    (input, ctx) => {
      // Freeze before the entire pending response group. Using its last tool
      // would include this read_history result while it is still changing.
      const before =
        input.before ?? historyBoundary(research, labId, ctx.actor.turnId);
      const messages = research.readHistory(labId, {
        before,
        limit: input.limit,
      });
      return {
        before: before ?? null,
        nextBefore: messages[0]?.id ?? null,
        page: jsonPage(
          messages,
          input.offset,
          input.maxBytes,
          input.fingerprint,
        ),
      };
    },
  );
  tool(
    "update_summary",
    "Update the research notebook with decisions, uncertainties and record IDs; original messages remain preserved.",
    z.object({ summary: z.string().min(1).max(15_000) }).strict(),
    (input, ctx) => research.updateSummary(labId, input.summary, ctx),
  );
}

function historyBoundary(
  research: ToolScope["research"],
  labId: string,
  turnId?: string,
): string | undefined {
  let before: string | undefined;
  let latest: string | undefined;
  let pendingStep: string | undefined;
  let boundary: string | undefined;
  // A researcher may enqueue many messages while a source tool is in flight;
  // walk pages until the pending group rather than assuming it is in the tail.
  while (true) {
    const page = research.readHistory(labId, { before, limit: 50 });
    latest ??= page.at(-1)?.id;
    if (!page.length) return boundary ?? latest;
    if (!pendingStep) {
      const pending = page.find(
        (message) =>
          message.toolCall?.status === "running" &&
          (!turnId || message.turnId === turnId),
      );
      if (pending) {
        boundary = pending.id;
        pendingStep = pending.modelStepId;
        if (!pendingStep) return boundary;
      }
    }
    if (pendingStep) {
      // persistReply inserts the assistant and every tool atomically and in
      // order. If the group starts at this page boundary, inspect its predecessor.
      const first = page.findIndex(
        (message) => message.modelStepId === pendingStep,
      );
      if (first < 0) return boundary;
      boundary = page[first]?.id;
      if (first > 0) return boundary;
    }
    before = page[0]?.id;
  }
}
