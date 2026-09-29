import { useState } from "react";
import { useMutation } from "@/web/api/use-mutation";
import { useTranslation } from "@/web/components/i18n";
import { Notice } from "@/web/components/primitives";

export function AdministrativeSettings() {
  const { t } = useTranslation();
  const [destination, setDestination] = useState("");
  const [saved, setSaved] = useState("");
  const action = useMutation();
  return (
    <details className="tool-call">
      <summary>{t("operations.backup")}</summary>
      <form
        className="form tool-body"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await action.mutate<{ path: string }>("/backup", {
            destination,
          });
          if (result) setSaved(result.path);
        }}
      >
        <p>{t("operations.backupHint")}</p>
        <label className="field">
          {t("operations.destination")}
          <input
            required
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>
        <button type="submit" disabled={action.busy}>
          {action.busy ? t("common.saving") : t("operations.backup")}
        </button>
        {saved && (
          <Notice>{t("operations.backupSaved", { path: saved })}</Notice>
        )}
        {action.error && <Notice error>{action.error}</Notice>}
        <p className="meta">{t("operations.restoreHint")}</p>
      </form>
    </details>
  );
}
