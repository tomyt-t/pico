import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import { useTranslation } from "@/web/components/i18n";
import { Icon } from "@/web/components/primitives";

const SheetContext = createContext<{ close: () => void; titleId: string }>({
  close: () => {},
  titleId: "",
});

/**
 * A panel docked to the right edge over the page. It is a modal dialog, so
 * Escape and the backdrop close it, and closing through the dialog returns
 * focus to the element that opened it.
 */
export function Sheet({
  onClose,
  className = "",
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => dialog.current?.close();
  return (
    <dialog
      className={`sheet ${className}`.trim()}
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <SheetContext.Provider value={{ close, titleId }}>
        {children}
      </SheetContext.Provider>
    </dialog>
  );
}

export function useSheet() {
  return useContext(SheetContext);
}

export function SheetHeader({
  eyebrow,
  title,
  onBack,
  backLabel,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Replaces the eyebrow with a way back to the previous panel. */
  onBack?: () => void;
  backLabel?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { close, titleId } = useSheet();
  return (
    <header className="sheet-head">
      <div className="sheet-head-row">
        {onBack ? (
          <button
            type="button"
            className="text-button sheet-back"
            onClick={onBack}
          >
            <Icon name="chevron" size={12} />
            {backLabel ?? t("common.back")}
          </button>
        ) : (
          <span className="sheet-eyebrow">{eyebrow}</span>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label={t("common.close")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <h2 id={titleId}>{title}</h2>
      {children && <div className="sheet-sub">{children}</div>}
    </header>
  );
}
