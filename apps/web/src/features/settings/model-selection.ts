import type { Lab, PiCatalog, ProviderConfig } from "@pico/lab/contracts";
import { useEffect, useRef, useState } from "react";
import { useModelCatalog } from "@/web/features/settings/settings-queries";

export type PiSelection = {
  provider: string;
  model: string;
  thinking: NonNullable<ProviderConfig["thinking"]>;
};
export function piDefaultSelection(catalog: PiCatalog): PiSelection | null {
  const preferred = catalog.defaultSelection;
  const preferredProvider = catalog.providers.find(
    (entry) => entry.id === preferred?.provider && entry.authenticated,
  );
  const preferredModel = preferredProvider?.models.find(
    (entry) => entry.id === preferred?.model,
  );
  if (preferredProvider && preferredModel)
    return {
      provider: preferredProvider.id,
      model: preferredModel.id,
      thinking: preferredModel.reasoning
        ? (preferred?.thinking ?? "off")
        : "off",
    };
  const available = catalog.providers.find(
    (entry) => entry.authenticated && entry.models.length > 0,
  );
  const model = available?.models[0];
  return available && model
    ? { provider: available.id, model: model.id, thinking: "off" }
    : null;
}

export function useModelSelection(lab?: Lab) {
  const [mode, setMode] = useState<ProviderConfig["mode"]>(
    lab?.settings.provider.mode ?? "pi",
  );
  const catalog = useModelCatalog();
  const modeChosen = useRef(false);
  const defaultsApplied = useRef(false);
  const [piProvider, setPiProvider] = useState(
    lab?.settings.provider.provider ?? "",
  );
  const [piModel, setPiModel] = useState(
    lab?.settings.provider.mode === "pi" ? lab.settings.provider.model : "",
  );
  const [thinking, setThinking] = useState<
    NonNullable<ProviderConfig["thinking"]>
  >(lab?.settings.provider.thinking ?? "off");
  const [baseUrl, setBaseUrl] = useState(
    lab?.settings.provider.baseUrl ?? "https://api.openai.com/v1",
  );
  const [model, setModel] = useState(
    lab?.settings.provider.mode === "openai-compatible"
      ? lab.settings.provider.model
      : "",
  );
  const [keyEnv, setKeyEnv] = useState(
    lab?.settings.provider.apiKeyEnv ?? "PICO_MODEL_API_KEY",
  );
  const selectedProvider = catalog.data?.providers.find(
    (entry) => entry.id === piProvider,
  );
  const selectedModel = selectedProvider?.models.find(
    (entry) => entry.id === piModel,
  );
  useEffect(() => {
    if (!catalog.data) return;
    if (!lab && !modeChosen.current && !defaultsApplied.current) {
      defaultsApplied.current = true;
      const defaults = piDefaultSelection(catalog.data);
      if (defaults) {
        setMode("pi");
        setPiProvider(defaults.provider);
        setPiModel(defaults.model);
        setThinking(defaults.thinking);
      } else setMode("demo");
      return;
    }
    if (mode === "pi" && !piProvider) {
      const defaults = piDefaultSelection(catalog.data);
      const first = catalog.data.providers.find(
        (entry) => entry.models.length > 0,
      );
      if (defaults) {
        setPiProvider(defaults.provider);
        setPiModel(defaults.model);
        setThinking(defaults.thinking);
      } else if (first) {
        setPiProvider(first.id);
        setPiModel(first.models[0]?.id ?? "");
        setThinking("off");
      }
    }
  }, [catalog.data, lab, mode, piProvider]);
  const changeMode = (next: ProviderConfig["mode"]) => {
    modeChosen.current = true;
    setMode(next);
  };
  const piIncomplete = mode === "pi" && (!piProvider || !piModel);

  return {
    mode,
    changeMode,
    catalog,
    piProvider,
    setPiProvider,
    piModel,
    setPiModel,
    thinking,
    setThinking,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    keyEnv,
    setKeyEnv,
    selectedProvider,
    selectedModel,
    piIncomplete,
    configuration: {
      mode,
      baseUrl,
      model: mode === "demo" ? "demo" : mode === "pi" ? piModel : model,
      apiKeyEnv: keyEnv,
      ...(mode === "pi" && {
        provider: piProvider,
        thinking: selectedModel?.reasoning === false ? "off" : thinking,
      }),
    } satisfies ProviderConfig,
  };
}
