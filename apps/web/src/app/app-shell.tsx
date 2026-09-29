import type { Lab, Turn } from "@pico/lab/contracts";
import type { CSSProperties, ReactNode } from "react";
import { navigate, type Page } from "@/web/app/navigation";
import { statusLabel } from "@/web/components/format";
import {
  currentLanguage,
  setLanguage,
  useTranslation,
} from "@/web/components/i18n";
import { Icon } from "@/web/components/primitives";
export const pages: {
  id: Page;
  icon: "chat" | "overview" | "experiment" | "library";
}[] = [
  { id: "chat", icon: "chat" },
  { id: "overview", icon: "overview" },
  { id: "experiments", icon: "experiment" },
  { id: "library", icon: "library" },
];
export function AppShell({
  labs,
  labId,
  lab,
  page,
  active,
  theme,
  onTheme,
  onSettings,
  onRefresh,
  children,
}: {
  labs: Lab[];
  labId: string;
  lab?: Lab;
  page: Page;
  active?: Turn | null;
  theme: "light" | "dark";
  onTheme: (theme: "light" | "dark") => void;
  onSettings: (value: "edit" | "new") => void;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("shell.skip")}
      </button>
      <div className="shell">
        <aside className="sidebar" aria-label={t("shell.navigation")}>
          <div className="brand">
            <span className="pico-mark">p</span>Pico
          </div>
          <div className="lab-switcher">
            <div className="lab-switcher-heading">
              <label htmlFor="lab-switch" className="eyebrow">
                {t("shell.laboratory")}
              </label>
              <button
                className="icon-button"
                type="button"
                onClick={() => onSettings("new")}
                aria-label={t("shell.newLaboratory")}
                title={t("shell.newLaboratory")}
              >
                <Icon name="plus" size={15} />
              </button>
            </div>
            <select
              id="lab-switch"
              value={labId}
              title={lab?.name}
              onChange={(event) =>
                navigate({ labId: event.target.value, page: "chat" })
              }
            >
              {!labs?.some((entry) => entry.id === labId) && (
                <option value={labId}>{t("shell.unknownLaboratory")}</option>
              )}
              {labs?.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label={t("shell.pagesLabel")}>
            {pages.map((entry) => (
              <button
                key={entry.id}
                className="nav-item"
                type="button"
                aria-current={page === entry.id ? "page" : undefined}
                onClick={() => navigate({ labId, page: entry.id })}
              >
                <Icon name={entry.icon} />
                <span>{t(`shell.pages.${entry.id}`)}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-detail">
            <p className="eyebrow">{t("shell.researchDirection")}</p>
            <p className="clamp" style={{ "--lines": 6 } as CSSProperties}>
              {lab?.researchLine || t("shell.directionPlaceholder")}
            </p>
          </div>
          <div className="sidebar-footer">
            <span className="session-indicator">
              <span className={`dot ${active ? "busy" : ""}`} />
              {active
                ? t("shell.picoStatus", {
                    status: statusLabel(active.status).toLowerCase(),
                  })
                : t("shell.picoIdle")}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => onSettings("edit")}
              disabled={!lab}
              aria-label={t("shell.settings")}
            >
              <Icon name="settings" size={17} />
            </button>
          </div>
        </aside>
        <main
          id="main-content"
          className="workspace"
          tabIndex={-1}
          aria-label={t(`shell.pages.${page}`)}
        >
          <header className="topbar">
            <div className="breadcrumbs">
              <strong>{lab?.name ?? t("shell.laboratory")}</strong>
              <span aria-hidden="true">/</span>
              <span>{t(`shell.pages.${page}`)}</span>
            </div>
            <div className="topbar-actions">
              {lab && (
                <button
                  className="model-chip"
                  type="button"
                  title={t("shell.openSettings")}
                  onClick={() => onSettings("edit")}
                >
                  {lab.settings.provider.mode === "pi" && (
                    <span className="muted">
                      {lab.settings.provider.provider ?? "Pi"}
                    </span>
                  )}
                  {lab.settings.provider.mode === "demo"
                    ? t("shell.demonstration")
                    : lab.settings.provider.model}
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                aria-label={t("shell.refresh")}
                title={t("shell.refresh")}
                onClick={onRefresh}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={
                  theme === "dark"
                    ? t("shell.lightTheme")
                    : t("shell.darkTheme")
                }
                title={
                  theme === "dark"
                    ? t("shell.lightTheme")
                    : t("shell.darkTheme")
                }
                onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
              </button>
              <button
                className="icon-button language-button"
                type="button"
                aria-label={t("shell.switchLanguage")}
                title={t("shell.switchLanguage")}
                onClick={() =>
                  setLanguage(currentLanguage() === "en" ? "pt-BR" : "en")
                }
              >
                {t("shell.languageCode")}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={t("shell.openSettings")}
                title={t("shell.settings")}
                onClick={() => onSettings("edit")}
                disabled={!lab}
              >
                <Icon name="settings" size={17} />
              </button>
            </div>
          </header>
          {lab?.settings.provider.mode === "demo" && (
            <div className="notice demo" role="status">
              {t("shell.demoNotice")}
              {!lab.settings.executionEnabled && (
                <>
                  {" "}
                  {t("shell.executionOff")}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onSettings("edit")}
                  >
                    {t("shell.settingsLink")}
                  </button>
                </>
              )}
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  );
}
