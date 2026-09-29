import { z } from "zod";
import type { JsonObject } from "@/lab/contracts/json";
import { id } from "@/lab/contracts/validation";

export type Actor = { kind: "researcher" | "pico" | "system"; turnId?: string };

export interface RecordMeta {
  id: string;
  labId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  author: Actor;
}

export interface Revision {
  id: string;
  recordId: string;
  labId: string;
  kind: string;
  revision: number;
  author: Actor;
  reason: string;
  snapshot: JsonObject;
  createdAt: string;
}

export interface MutationContext {
  key: string;
  actor: Actor;
}

export const actorSchema = z
  .object({
    kind: z.enum(["researcher", "pico", "system"]),
    turnId: id.optional(),
  })
  .strict();
