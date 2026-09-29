import type { Lab } from "@pico/lab/contracts";
import { useEffect, useId, useRef } from "react";
import { Icon } from "@/web/components/primitives";
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
        <h2 id={titleId}>{lab ? "Laboratory settings" : "New laboratory"}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close settings"
        >
          <Icon name="close" />
        </button>
      </div>
      <LabForm lab={lab} onSaved={onSaved} onCancel={onClose} />
    </dialog>
  );
}
