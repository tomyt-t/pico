import type { z } from "zod";
import type { MutationContext } from "@/lab/contracts";
import type { ModelTool } from "@/lab/models/model-contract";
import type { Research } from "@/lab/research/laboratory";

export interface Tool extends ModelTool {
  execute(input: unknown, context: MutationContext): Promise<unknown>;
}
export interface ToolScope {
  research: Research;
  labId: string;
  signal?: AbortSignal;
  tool<T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    execute: (input: T, ctx: MutationContext) => unknown | Promise<unknown>,
  ): void;
}
