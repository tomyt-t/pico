import type { Lab, LabSettings, ProviderStatus } from "@pico/lab/contracts";
import { useState } from "react";
import { labPath } from "@/web/api/http-client";
import { useMutation } from "@/web/api/use-mutation";
import { useTranslation } from "@/web/components/i18n";
import { Notice } from "@/web/components/primitives";
import { ModelFields } from "@/web/features/settings/model-fields";
import { useModelSelection } from "@/web/features/settings/model-selection";
import { useProviderStatus } from "@/web/features/settings/settings-queries";

export function LabForm({
  lab,
  onSaved,
  onCancel,
}: {
  lab?: Lab;
  onSaved: (lab: Lab) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const selection = useModelSelection(lab);
  const [name, setName] = useState(lab?.name ?? t("settings.defaultName"));
  const [line, setLine] = useState(lab?.researchLine ?? "");
  const [execution, setExecution] = useState(
    lab?.settings.executionEnabled ?? false,
  );
  const [seconds, setSeconds] = useState(
    lab ? String(lab.settings.maxRunSeconds ?? "") : "120",
  );
  const [steps, setSteps] = useState(
    lab ? String(lab.settings.maxModelSteps ?? "") : "16",
  );
  const [tokens, setTokens] = useState(
    String(lab?.settings.maxModelTokens ?? ""),
  );
  const [cost, setCost] = useState(String(lab?.settings.maxModelCostUsd ?? ""));
  const action = useMutation();
  const test = useMutation();
  const provider = useProviderStatus(lab?.id);
  const [tested, setTested] = useState<ProviderStatus | null>(null);

  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const settings: LabSettings = {
          executionEnabled: execution,
          maxRunSeconds: seconds ? Number(seconds) : null,
          maxConcurrentRuns: lab?.settings.maxConcurrentRuns ?? 1,
          maxModelSteps: steps ? Number(steps) : null,
          maxModelTokens: tokens ? Number(tokens) : null,
          maxModelCostUsd: cost ? Number(cost) : null,
          provider: selection.configuration,
        };
        const saved = await action.mutate<Lab>(
          lab ? labPath(lab.id) : "/labs",
          { name: name.trim(), researchLine: line.trim(), settings },
          lab ? "PATCH" : "POST",
        );
        if (saved) onSaved(saved);
      }}
    >
      {action.error && (
        <Notice error>
          {action.error} {t("settings.retryHint")}
        </Notice>
      )}
      <h3 className="form-section">{t("settings.laboratory")}</h3>
      <label className="field">
        {t("settings.name")}
        <input
          name="laboratoryName"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        {t("settings.researchLine")}
        <textarea
          name="researchLine"
          placeholder={t("settings.researchPlaceholder")}
          value={line}
          maxLength={3000}
          onChange={(e) => setLine(e.target.value)}
        />
        <small>{t("settings.researchHint")}</small>
      </label>
      <h3 className="form-section">{t("settings.model")}</h3>
      <ModelFields selection={selection} lab={lab} />
      <h3 className="form-section">{t("settings.execution")}</h3>
      <label className="run-selection">
        <input
          name="executionEnabled"
          type="checkbox"
          checked={execution}
          onChange={(e) => setExecution(e.target.checked)}
        />
        <span>{t("settings.allowExecution")}</span>
      </label>
      <div className="field-row">
        <label className="field">
          {t("settings.runLimit")}
          <input
            name="runTimeLimit"
            type="number"
            min={1}
            max={86400}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            placeholder={t("operations.unlimited")}
          />
        </label>
        <label className="field">
          {t("settings.stepLimit")}
          <input
            name="turnStepLimit"
            type="number"
            min={1}
            max={100}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={t("operations.unlimited")}
          />
        </label>
      </div>
      <p className="meta">{t("settings.limitHint")}</p>
      {lab && (
        <div className="stack">
          <div className="actions">
            <span className="meta">
              {t("settings.savedProvider", {
                detail:
                  provider.data?.detail ??
                  (provider.error || t("settings.checkingConfiguration")),
              })}
            </span>
            <button
              type="button"
              className="small"
              disabled={test.busy}
              onClick={async () => {
                const result = await test.mutate<ProviderStatus>(
                  labPath(lab.id, "/provider/test"),
                );
                if (result) setTested(result);
              }}
            >
              {test.busy ? t("settings.checking") : t("settings.checkProvider")}
            </button>
          </div>
          {tested && (
            <Notice error={!tested.configured}>{tested.detail}</Notice>
          )}
          {test.error && <Notice error>{test.error}</Notice>}
        </div>
      )}
      <div className="field-row">
        <label className="field">
          {t("operations.tokenBudget")}
          <input
            type="number"
            min={1}
            step={1}
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            placeholder={t("operations.unlimited")}
          />
        </label>
        <label className="field">
          {t("operations.costBudget")}
          <input
            type="number"
            min={0.000001}
            step="any"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            placeholder={t("operations.unlimited")}
          />
        </label>
      </div>
      <p className="meta">{t("operations.budgetHint")}</p>
      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={action.busy || selection.piIncomplete}
        >
          {action.busy
            ? t("common.saving")
            : lab
              ? t("settings.saveChanges")
              : t("app.createLaboratory")}
        </button>
      </div>
    </form>
  );
}
