import type { Lab } from "@pico/lab/contracts";
import { useTranslation } from "@/web/components/i18n";
import { LabForm } from "@/web/features/settings/laboratory-form";

export function Setup({ onCreated }: { onCreated: (lab: Lab) => void }) {
  const { t } = useTranslation();
  return (
    <div className="setup">
      <main className="setup-card">
        <div className="brand">
          <span className="pico-mark">p</span>Pico
        </div>
        <h1>{t("settings.setupTitle")}</h1>
        <p className="subheading" style={{ marginBottom: 28 }}>
          {t("settings.setupSubtitle")}
        </p>
        <LabForm onSaved={onCreated} />
      </main>
    </div>
  );
}
