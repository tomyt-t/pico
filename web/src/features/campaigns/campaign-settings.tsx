import type { CampaignSettings as Limits } from "@pico/server/contracts";
import { useState } from "react";
import { useAction } from "@/web/api/use-action";
import { usePoll } from "@/web/api/use-poll";
import { useTranslation } from "@/web/components/i18n";
import { Notice } from "@/web/components/primitives";
import { QueryState } from "@/web/components/query-state";
import { Pane, PaneFooter } from "@/web/features/settings/settings-dialog";

const keys = ["budgetUsd", "maxAgents", "labMaxAgents"] as const;

export function CampaignLimitsForm({
  initial,
  onClose,
  onAgents,
}: {
  initial: Limits;
  onClose: () => void;
  onAgents?: () => void;
}) {
  const { t } = useTranslation();
  const action = useAction();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState<Limits>(initial);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = keys.some((key) => values[key] !== saved[key])
    ? t("campaigns.title")
    : "";
  const labels = {
    budgetUsd: t("campaigns.budget"),
    maxAgents: t("campaigns.maxAgents"),
    labMaxAgents: t("campaigns.labMaxAgents"),
  };
  const hints = {
    budgetUsd: t("campaigns.budgetFieldHint"),
    maxAgents: t("campaigns.maxAgentsHint"),
    labMaxAgents: t("campaigns.labMaxAgentsHint"),
  };
  return (
    <Pane
      title={t("campaigns.title")}
      hint={t("campaigns.settingsHint")}
      onClose={onClose}
      onSubmit={async () => {
        setJustSaved(false);
        if (await action.run("/campaign-settings", values, "PATCH")) {
          setSaved(values);
          setJustSaved(true);
        }
      }}
      footer={
        <PaneFooter
          dirty={dirty}
          saved={justSaved}
          busy={action.busy}
          onDiscard={() => setValues(saved)}
          onCancel={onClose}
        />
      }
    >
      <div className="settings-grid3">
        {keys.map((key) => (
          <label className="field" key={key}>
            {labels[key]}
            <span className="input-unit">
              {key === "budgetUsd" && <span className="unit">US$</span>}
              <input
                type="number"
                min={key === "budgetUsd" ? "0.01" : "1"}
                step={key === "budgetUsd" ? "0.01" : "1"}
                required
                value={values[key]}
                onChange={(event) => {
                  setValues({ ...values, [key]: Number(event.target.value) });
                  setJustSaved(false);
                }}
              />
            </span>
            <small>{hints[key]}</small>
          </label>
        ))}
      </div>
      <p className="meta">
        {t("campaigns.coordinatorModelHint")}{" "}
        {onAgents && (
          <button type="button" className="text-button" onClick={onAgents}>
            {t("agents.settingsTitle")}
          </button>
        )}
      </p>
      <p className="meta">{t("campaigns.budgetHint")}</p>
      {action.error && <Notice error>{action.error}</Notice>}
    </Pane>
  );
}

export function CampaignsPane({
  onClose,
  onAgents,
}: {
  onClose: () => void;
  onAgents?: () => void;
}) {
  const settings = usePoll<Limits>("/campaign-settings", 60_000);
  return (
    <QueryState
      loading={settings.loading}
      error={settings.error}
      hasData={!!settings.data}
      refresh={settings.refresh}
    >
      {settings.data && (
        <CampaignLimitsForm
          initial={settings.data}
          onClose={onClose}
          onAgents={onAgents}
        />
      )}
    </QueryState>
  );
}
