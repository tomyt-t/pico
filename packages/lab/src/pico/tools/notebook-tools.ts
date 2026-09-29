import { z } from "zod";
import type { ToolScope } from "@/lab/pico/tools/tool-definition";

const id = z.string().min(1);

export function registerNotebookTools({
  research,
  labId,
  tool,
}: ToolScope): void {
  tool(
    "read_history",
    "Read preserved conversation messages; pass the first message ID as before for older pages.",
    z
      .object({
        before: id.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
    (input) => research.readHistory(labId, input),
  );
  tool(
    "update_summary",
    "Update the research notebook with decisions, uncertainties and record IDs; original messages remain preserved.",
    z.object({ summary: z.string().min(1).max(15_000) }).strict(),
    (input, ctx) => research.updateSummary(labId, input.summary, ctx),
  );
}
