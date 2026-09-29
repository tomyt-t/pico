import { z } from "zod";
import type { JsonObject } from "@/lab/contracts";
import { registerExperimentTools } from "@/lab/pico/tools/experiment-tools";
import { registerLibraryTools } from "@/lab/pico/tools/library-tools";
import { registerNotebookTools } from "@/lab/pico/tools/notebook-tools";
import { registerResearchTools } from "@/lab/pico/tools/research-tools";
import type { Tool, ToolScope } from "@/lab/pico/tools/tool-definition";
import type { Research } from "@/lab/research/laboratory";

export function createTools(
  research: Research,
  labId: string,
  signal?: AbortSignal,
): Map<string, Tool> {
  const catalog = new Map<string, Tool>();
  const scope: ToolScope = {
    research,
    labId,
    signal,
    tool(name, description, schema, execute) {
      const { $schema: _schema, ...parameters } = z.toJSONSchema(schema, {
        io: "input",
      });
      catalog.set(name, {
        name,
        description,
        parameters: parameters as JsonObject,
        execute: async (input, ctx) => execute(schema.parse(input), ctx),
      });
    },
  };
  registerResearchTools(scope);
  registerExperimentTools(scope);
  registerLibraryTools(scope);
  registerNotebookTools(scope);
  return catalog;
}
