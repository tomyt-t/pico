import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CredentialInfo } from "@earendil-works/pi-ai";
import {
  type CreateModelRuntimeOptions,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  PiCatalog,
  PiProviderOption,
  ProviderConfig,
  ProviderStatus,
} from "@/lab/contracts";
import { providerStatus } from "@/lab/models/openai-compatible";

export interface PiRuntime {
  models(): Promise<ModelRuntime>;
  catalog(): Promise<PiCatalog>;
  status(config: ProviderConfig): Promise<ProviderStatus>;
  close(): Promise<void>;
}

export interface PiRuntimeOptions {
  agentDir: string;
  cwd?: string;
  /** Test seam; production always uses the public Pi SDK factory. */
  runtimeFactory?: (
    options: CreateModelRuntimeOptions,
  ) => Promise<ModelRuntime>;
}

const setupError =
  "Pi configuration could not be loaded. Check your Pi auth.json and models.json files.";
const thinkingLevels: readonly NonNullable<ProviderConfig["thinking"]>[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Reuses Pi's credential store and locking; scientific data never contains credential values. */
export function createPiRuntime(options: PiRuntimeOptions): PiRuntime {
  const agentDir = resolve(options.agentDir);
  const cwd = resolve(options.cwd ?? join(agentDir, "workspace"));
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let runtime: Promise<ModelRuntime> | undefined;
  let runtimeSignature: string | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;

  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("Pi access is closed"));
    const promise = Promise.resolve()
      .then(operation)
      .finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  }

  function models(): Promise<ModelRuntime> {
    if (closed) return Promise.reject(new Error("Pi access is closed"));
    let signature: string;
    try {
      const metadata = statSync(join(agentDir, "models.json"), {
        bigint: true,
      });
      signature = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return Promise.reject(new Error(setupError));
      signature = "missing";
    }
    if (!runtime || runtimeSignature !== signature) {
      runtimeSignature = signature;
      // Rebuild only local metadata. SDK refresh() also refreshes availability
      // and authentication, which can execute configured key commands.
      // In-flight inferences retain the instance they already acquired.
      const loading = track(async () => {
        try {
          return await (options.runtimeFactory ?? ModelRuntime.create)({
            authPath: join(agentDir, "auth.json"),
            modelsPath: join(agentDir, "models.json"),
            modelsStorePath: join(agentDir, "models-store.json"),
            allowModelNetwork: false,
            refreshOnCreate: false,
            signal: controller.signal,
          });
        } catch {
          if (runtime === loading) runtime = undefined;
          throw new Error(setupError);
        }
      });
      runtime = loading;
    }
    return runtime;
  }

  async function configured(
    instance: ModelRuntime,
    providerId: string,
    credentials: readonly CredentialInfo[],
  ): Promise<boolean> {
    const provider = instance.getProvider(providerId);
    if (!provider) return false;
    const credential = credentials.find(
      (entry) => entry.providerId === providerId,
    );
    if (credential) {
      // Listing credentials does not resolve configured !commands or refresh OAuth.
      return credential.type === "oauth"
        ? Boolean(provider.auth.oauth)
        : credential.type === "api_key" && Boolean(provider.auth.apiKey);
    }
    if (instance.getProviderAuthStatus(providerId).configured) return true;
    // No stored credential or models.json command exists: Pi can check ambient
    // configuration without running a configured key command or refreshing OAuth.
    return Boolean(
      await instance.checkAuth(providerId, { signal: controller.signal }),
    );
  }

  function catalog(): Promise<PiCatalog> {
    return track(async () => {
      const warnings = new Set<string>();
      const result: PiCatalog = {
        agentDir,
        providers: [],
        defaultSelection: null,
      };
      try {
        const instance = await models();
        const credentials = await instance.listCredentials({
          signal: controller.signal,
        });
        if (instance.getError())
          warnings.add("Some Pi model configuration could not be loaded.");
        result.providers = await Promise.all(
          instance.getProviders().map(async (provider) => {
            let authenticated = false;
            try {
              authenticated = await configured(
                instance,
                provider.id,
                credentials,
              );
            } catch {
              warnings.add(
                "Some Pi authentication metadata could not be checked.",
              );
            }
            const option: PiProviderOption = {
              id: provider.id,
              name: provider.name,
              authenticated,
              models: instance.getModels(provider.id).map((model) => ({
                id: model.id,
                name: model.name,
                input: [...model.input],
                reasoning: model.reasoning,
                contextWindow: model.contextWindow,
                maxTokens: model.maxTokens,
              })),
            };
            return option;
          }),
        );
        const settings = SettingsManager.create(cwd, agentDir, {
          projectTrusted: false,
        });
        if (settings.drainErrors().length)
          warnings.add("Pi settings could not be read. Check settings.json.");
        const provider = settings.getDefaultProvider();
        const model = settings.getDefaultModel();
        if (provider && model) {
          if (instance.getModel(provider, model)) {
            const level =
              settings.getModelThinkingLevel(provider, model) ??
              settings.getDefaultThinkingLevel();
            const thinking = thinkingLevels.find(
              (candidate) => candidate === level,
            );
            if (level && !thinking)
              warnings.add(
                "The Pi thinking level is not supported by this Pico version.",
              );
            result.defaultSelection = {
              provider,
              model,
              ...(thinking ? { thinking } : {}),
            };
          } else
            warnings.add(
              "The default model in Pi settings is not in the current Pi catalog. Select an available model.",
            );
        }
      } catch {
        warnings.add(setupError);
      }
      if (warnings.size) result.warning = [...warnings].join(" ");
      return result;
    });
  }

  function status(config: ProviderConfig): Promise<ProviderStatus> {
    if (config.mode !== "pi") return Promise.resolve(providerStatus(config));
    return track(async () => {
      const base: ProviderStatus = {
        mode: "pi",
        model: config.model,
        configured: false,
        detail: "Select a Pi provider and model.",
      };
      if (!config.provider || !config.model) return base;
      try {
        const instance = await models();
        if (!instance.getModel(config.provider, config.model))
          return {
            ...base,
            detail: "This model is not in the selected Pi provider's catalog.",
          };
        const credentials = await instance.listCredentials({
          signal: controller.signal,
        });
        const ready = await configured(instance, config.provider, credentials);
        return {
          ...base,
          configured: ready,
          detail: ready
            ? "Pi credential configuration is available. Connection and OAuth refresh are verified on the next inference."
            : "Run bun run pi, then /login in Pico's isolated profile, or configure the provider's environment credentials for Pico.",
        };
      } catch {
        return { ...base, detail: setupError };
      }
    });
  }

  return {
    models,
    catalog,
    status,
    close(): Promise<void> {
      closed = true;
      controller.abort();
      closing ??= Promise.allSettled([...pending]).then(() => undefined);
      return closing;
    },
  };
}
