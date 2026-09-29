import type { Lab, ProviderConfig } from "@pico/lab/contracts";
import { locale } from "@/web/components/format";
import { Trans, useTranslation } from "@/web/components/i18n";
import { Notice } from "@/web/components/primitives";
import type { useModelSelection } from "@/web/features/settings/model-selection";

export function ModelFields({
  selection,
  lab,
}: {
  selection: ReturnType<typeof useModelSelection>;
  lab?: Lab;
}) {
  const {
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
  } = selection;
  const { t } = useTranslation();
  return (
    <>
      <label className="field">
        {t("model.label")}
        <select
          name="providerMode"
          value={mode}
          onChange={(e) => changeMode(e.target.value as ProviderConfig["mode"])}
        >
          <option value="pi">{t("model.pi")}</option>
          <option value="demo">{t("model.demo")}</option>
          <option value="openai-compatible">{t("model.advanced")}</option>
        </select>
      </label>
      {mode === "pi" ? (
        <>
          <Notice>
            <Trans i18nKey="model.piNotice" components={{ code: <code /> }} />
          </Notice>
          {catalog.loading && (
            <p className="meta" role="status">
              {t("model.loadingCatalog")}
            </p>
          )}
          {catalog.error && (
            <Notice error>
              {t("model.catalogError", { error: catalog.error })}{" "}
              {lab?.settings.provider.mode === "pi"
                ? t("model.selectionPreserved")
                : t("model.catalogAlternatives")}{" "}
              <button
                type="button"
                className="text-button"
                onClick={catalog.refresh}
              >
                {t("common.retry")}
              </button>
            </Notice>
          )}
          {catalog.data?.warning && <Notice>{catalog.data.warning}</Notice>}
          {catalog.data && !catalog.data.providers.length && (
            <Notice>
              <Trans
                i18nKey="model.noProviders"
                components={{ code: <code /> }}
              />{" "}
              <button
                type="button"
                className="text-button"
                onClick={catalog.refresh}
              >
                {t("model.refreshCatalog")}
              </button>
            </Notice>
          )}
          <div className="field-row">
            <label className="field">
              {t("model.provider")}
              <select
                name="piProvider"
                required
                value={piProvider}
                onChange={(event) => {
                  const next = catalog.data?.providers.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setPiProvider(event.target.value);
                  setPiModel(next?.models[0]?.id ?? "");
                  setThinking("off");
                }}
              >
                <option value="" disabled>
                  {t("model.selectProvider")}
                </option>
                {piProvider && !selectedProvider && (
                  <option value={piProvider}>
                    {t("model.savedSelection", { value: piProvider })}
                  </option>
                )}
                {catalog.data?.providers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.authenticated
                      ? t("model.signedIn")
                      : t("model.signInRequired")}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("model.piModel")}
              <select
                name="piModel"
                required
                value={piModel}
                onChange={(event) => {
                  setPiModel(event.target.value);
                  if (
                    selectedProvider?.models.find(
                      (entry) => entry.id === event.target.value,
                    )?.reasoning === false
                  )
                    setThinking("off");
                }}
              >
                <option value="" disabled>
                  {t("model.selectModel")}
                </option>
                {piModel && !selectedModel && (
                  <option value={piModel}>
                    {t("model.savedSelection", { value: piModel })}
                  </option>
                )}
                {selectedProvider?.models.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedProvider && !selectedProvider.authenticated && (
            <Notice>{t("model.noSignIn")}</Notice>
          )}
          {catalog.data && piProvider && !selectedProvider && (
            <Notice>{t("model.providerMissing")}</Notice>
          )}
          {selectedProvider && piModel && !selectedModel && (
            <Notice>{t("model.modelMissing")}</Notice>
          )}
          {selectedModel && (
            <p className="meta">
              {t("model.capabilities", {
                input: selectedModel.input.includes("image")
                  ? t("model.textImage")
                  : t("model.text"),
                contextWindow: selectedModel.contextWindow.toLocaleString(
                  locale(),
                ),
                output: selectedModel.maxTokens.toLocaleString(locale()),
              })}
            </p>
          )}
          <label className="field">
            {t("model.reasoning")}
            <select
              name="piThinking"
              value={selectedModel?.reasoning === false ? "off" : thinking}
              disabled={selectedModel?.reasoning === false}
              onChange={(event) =>
                setThinking(
                  event.target.value as NonNullable<ProviderConfig["thinking"]>,
                )
              }
            >
              {(
                [
                  "off",
                  "minimal",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {t(`model.reasoningLevels.${value}`)}
                </option>
              ))}
            </select>
            <small>
              {selectedModel?.reasoning === false
                ? t("model.reasoningUnavailable")
                : t("model.reasoningHint")}
            </small>
          </label>
        </>
      ) : mode === "demo" ? (
        <Notice>{t("model.demoNotice")}</Notice>
      ) : (
        <>
          <label className="field">
            {t("model.endpoint")}
            <input
              name="providerEndpoint"
              required
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <div className="field-row">
            <label className="field">
              {t("model.modelName")}
              <input
                name="providerModel"
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t("model.modelPlaceholder")}
              />
            </label>
            <label className="field">
              {t("model.keyVariable")}
              <input
                name="credentialVariable"
                required
                pattern="[A-Z_][A-Z0-9_]*"
                value={keyEnv}
                onChange={(e) => setKeyEnv(e.target.value)}
                placeholder="PICO_MODEL_API_KEY"
              />
            </label>
          </div>
          <p className="meta">{t("model.keyHint")}</p>
        </>
      )}
    </>
  );
}
