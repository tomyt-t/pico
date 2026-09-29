import type { Lab } from "@pico/lab/contracts";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "@/web/components/i18n";
import { Icon } from "@/web/components/primitives";
import { AdministrativeSettings } from "@/web/features/settings/administrative-settings";
import { LabForm } from "@/web/features/settings/laboratory-form";

export function Settings({
  lab,
  onClose,
  onSaved,
}: {
  lab?: Lab;
  onClose: () => void;
  onSaved: (lab: Lab) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="modal-heading">
        <h2 id={titleId}>
          {lab ? t("settings.title") : t("settings.newTitle")}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("settings.closeLabel")}
        >
          <Icon name="close" />
        </button>
      </div>
      <LabForm lab={lab} onSaved={onSaved} onCancel={onClose} />
      {lab && <AdministrativeSettings />}
    </dialog>
  );
}
