import { randomUUID } from "node:crypto";
import type {
  CreateLabInput,
  Lab,
  LabSettings,
  MutationContext,
} from "@/lab/contracts";
import { actorSchema, labSchema } from "@/lab/contracts";
import { parse } from "@/lab/research/errors";
import { type ResearchContext, timestamp } from "@/lab/research/mutations";

const defaults: LabSettings = {
  executionEnabled: false,
  maxRunSeconds: 60,
  maxConcurrentRuns: 1,
  maxModelSteps: 12,
  provider: {
    mode: "demo",
    baseUrl: "https://api.openai.com/v1",
    model: "demo",
    apiKeyEnv: "PICO_MODEL_API_KEY",
  },
};
export function listLabs(context: ResearchContext): Lab[] {
  return context.repo.list<Lab>("lab");
}
export function createLab(
  context: ResearchContext,
  input: CreateLabInput,
  ctx: MutationContext = { key: randomUUID(), actor: { kind: "researcher" } },
): Lab {
  return context.operations.mutate(
    {
      labId: "__labs__",
      key: ctx.key,
      operation: "createLab",
      input: { input, actor: ctx.actor },
    },
    () => {
      parse(actorSchema, ctx.actor);
      const fields = parse(labSchema, {
        ...input,
        settings: {
          ...defaults,
          ...input.settings,
          provider: { ...defaults.provider, ...input.settings?.provider },
        },
      });
      const now = timestamp();
      const lab: Lab = {
        ...fields,
        id: randomUUID(),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      context.repo.insert("lab", lab.id, lab);
      context.conversations.createConversation({
        id: randomUUID(),
        labId: lab.id,
        summary: "",
        summaryThroughMessageId: null,
        createdAt: now,
        updatedAt: now,
      });
      context.event(
        lab.id,
        "lab_created",
        "lab",
        lab.id,
        `Created laboratory ${lab.name}`,
      );
      return lab;
    },
  );
}
export function updateLab(
  context: ResearchContext,
  labId: string,
  patch: Partial<Pick<Lab, "name" | "researchLine">> & {
    settings?: Partial<LabSettings>;
  },
  ctx: MutationContext,
): Lab {
  return context.mutate(labId, "updateLab", patch, ctx, () => {
    const lab = context.getLab(labId);
    const fields = parse(labSchema, {
      name: lab.name,
      researchLine: lab.researchLine,
      ...patch,
      settings: {
        ...lab.settings,
        ...patch.settings,
        provider: { ...lab.settings.provider, ...patch.settings?.provider },
      },
    });
    const updated = {
      ...lab,
      ...fields,
      revision: lab.revision + 1,
      updatedAt: timestamp(),
    };
    context.repo.revise("lab", labId, updated, {
      author: ctx.actor,
      reason: "Updated laboratory direction or settings",
    });
    context.event(
      labId,
      "lab_updated",
      "lab",
      labId,
      "Updated laboratory direction or settings",
    );
    return updated;
  });
}
