import { z } from "zod";
import type { ProviderConfig } from "@/lab/contracts/models";
import { optionalText, text } from "@/lab/contracts/validation";

export interface LabSettings {
  executionEnabled: boolean;
  maxRunSeconds: number;
  maxConcurrentRuns: number;
  maxModelSteps: number;
  provider: ProviderConfig;
}

export interface Lab {
  id: string;
  name: string;
  researchLine: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  settings: LabSettings;
}

export interface CreateLabInput {
  name: string;
  researchLine?: string;
  settings?: Partial<LabSettings>;
}

export const settingsSchema = z
  .object({
    executionEnabled: z.boolean(),
    maxRunSeconds: z.number().int().min(1).max(86_400),
    maxConcurrentRuns: z.number().int().min(1).max(16),
    maxModelSteps: z.number().int().min(1).max(100),
    provider: z
      .object({
        mode: z.enum(["demo", "pi", "openai-compatible"]),
        baseUrl: z
          .string()
          .url()
          .refine((value) => {
            const endpoint = new URL(value);
            return (
              !endpoint.username &&
              !endpoint.password &&
              !endpoint.search &&
              !endpoint.hash &&
              (endpoint.protocol === "https:" ||
                (endpoint.protocol === "http:" &&
                  ["localhost", "127.0.0.1", "[::1]"].includes(
                    endpoint.hostname,
                  )))
            );
          }, "Use an HTTPS endpoint (HTTP is allowed for localhost), without credentials, query parameters or fragments"),
        model: z.string().trim().min(1).max(200),
        apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
        provider: z.string().trim().min(1).max(200).optional(),
        thinking: z
          .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
          .optional(),
      })
      .strict()
      .refine(
        (value) => value.mode !== "pi" || Boolean(value.provider),
        "Choose a Pi provider",
      ),
  })
  .strict();
export const labSchema = z
  .object({
    name: text.max(200),
    researchLine: optionalText,
    settings: settingsSchema,
  })
  .strict();
