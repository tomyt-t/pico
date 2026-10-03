import type { Lab, ResearchRecord, SessionState } from "@pico/server/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { modifierKey } from "@/web/app/command-palette";
import { LabAvatar, LabSwitcher } from "@/web/app/lab-switcher";
import {
  navigate,
  type Page,
  parseRoute,
  useRoute,
} from "@/web/app/navigation";
import { remember, savedSidebar } from "@/web/app/theme";
import {
  currentLanguage,
  setLanguage,
  useTranslation,
} from "@/web/components/i18n";
import { Logo } from "@/web/components/logo";
import { Icon, type IconName } from "@/web/components/primitives";
import {
  type ActivitySummary,
  summaryText,
} from "@/web/features/campaigns/summary";

export const pages: { id: Page; icon: IconName }[] = [
  { id: "chat", icon: "chat" },
  { id: "panorama", icon: "overview" },
  { id: "investigations", icon: "experiment" },
  { id: "evolution", icon: "evolution" },
  { id: "collection", icon: "library" },
];

export function AppShell({
  labs,
  labId,
  lab,
  page,
  pageId,
  pages: pageRecords = [],
  panorama,
  session,
  researchLine = "",
  activity,
  theme,
  onTheme,
  onSettings,
  onRefresh,
  onChatToggle,
  onModelChip,
  onSearch,
  chatOpen = false,
  children,
}: {
  labs: Lab[];
  labId: string;
  lab?: Lab;
  page: Page;
  pageId?: string;
  pages?: ResearchRecord[];
  panorama?: ResearchRecord;
  session?: SessionState;
  /** The lab's research line, or the one read from the laboratory context when the record is empty. */
  researchLine?: string;
  /** Campaigns and specialists at work, summarised under Pico's state. */
  activity?: ActivitySummary;
  theme: "light" | "dark";
  onTheme: (theme: "light" | "dark") => void;
  onSettings: (value: "edit" | "new") => void;
  onRefresh: () => void;
  onChatToggle?: () => void;
  /** Opens the conversation on the model picker; the chip is hidden without it. */
  onModelChip?: () => void;
  /** Opens the command palette; the search trigger is hidden without it. */
  onSearch?: () => void;
  chatOpen?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(
    () => savedSidebar() === "collapsed",
  );
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    remember("pico-sidebar", collapsed ? "expanded" : "collapsed");
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const desktopIdentity = useRef<HTMLButtonElement>(null);
  const model = session?.model
    ? `${session.model.provider}/${session.model.id}`
    : lab?.model
      ? `${lab.provider ?? ""}/${lab.model}`
      : t("shell.defaultModel");
  const labName = lab?.name ?? t("shell.noLaboratory");
  const sessionLabel = t(
    !session
      ? "activity.unknown"
      : session.streaming
        ? "shell.working"
        : "shell.idle",
  );
  const labPanorama =
    panorama?.labId === labId && panorama.kind === "page"
      ? panorama
      : undefined;
  const labPages = pageRecords.filter(
    (record) =>
      record.labId === labId &&
      record.kind === "page" &&
      record.id !== labPanorama?.id,
  );
  const currentPage =
    page === "panorama"
      ? labPanorama
      : page === "pages"
        ? [labPanorama, ...labPages].find((record) => record?.id === pageId)
        : undefined;
  // A record reached from another page keeps that page lit in the menu.
  const route = useRoute();
  const origin = route?.from ? parseRoute(route.from)?.page : undefined;
  const sidebarPage = (value: Page): Page =>
    value === "overview"
      ? "panorama"
      : value === "experiments"
        ? "investigations"
        : value === "library" || value === "files"
          ? "collection"
          : value;
  const navigationPage =
    page === "pages" && labPanorama && pageId === labPanorama.id
      ? "panorama"
      : page === "experiments" && origin
        ? sidebarPage(origin)
        : sidebarPage(page);
  const pageLabel = currentPage?.title || t(`shell.pages.${navigationPage}`);
  const searchLabel = t("palette.open", { key: modifierKey() });
  const closeMenu = () => drawer.current?.close();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const resized = () => {
      if (!query.matches && drawer.current?.open) {
        setPickerOpen(false);
        drawer.current.close();
        // Close the picker above the drawer before focusing the desktop shell.
        requestAnimationFrame(() => desktopIdentity.current?.focus());
      }
    };
    query.addEventListener("change", resized);
    return () => query.removeEventListener("change", resized);
  }, []);

  const sidebar = (mobile: boolean) => (
    <>
      <div className="sidebar-heading">
        <span className="eyebrow">{t("shell.laboratory")}</span>
        <span className="sidebar-heading-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => (mobile ? closeMenu() : toggleCollapsed())}
            aria-label={
              mobile
                ? t("shell.closeNavigation")
                : t(
                    collapsed
                      ? "shell.expandNavigation"
                      : "shell.collapseNavigation",
                  )
            }
            title={
              mobile
                ? t("shell.closeNavigation")
                : t(
                    collapsed
                      ? "shell.expandNavigation"
                      : "shell.collapseNavigation",
                  )
            }
            aria-expanded={mobile ? undefined : !collapsed}
            aria-controls={mobile ? undefined : "laboratory-navigation"}
          >
            <Icon
              name={mobile ? "close" : collapsed ? "panel-open" : "panel-close"}
              size={17}
            />
          </button>
        </span>
      </div>
      <button
        ref={mobile ? undefined : desktopIdentity}
        className="lab-identity"
        type="button"
        onClick={() => setPickerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label={t("shell.switchLaboratoryNamed", { name: labName })}
        title={labName}
      >
        <LabAvatar name={lab?.name} />
        <span className="lab-identity-copy">
          <strong>{labName}</strong>
          {researchLine && <small>{researchLine}</small>}
        </span>
        <Icon name="chevron" size={12} />
      </button>
      {onSearch && (
        <button
          type="button"
          className="sidebar-search"
          aria-label={searchLabel}
          title={searchLabel}
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
          disabled={!lab}
          onClick={() => {
            closeMenu();
            onSearch();
          }}
        >
          <Icon name="search" size={15} />
          <span className="nav-label">{t("shell.search")}</span>
          <kbd>{modifierKey()}K</kbd>
        </button>
      )}
      <nav
        id={mobile ? undefined : "laboratory-navigation"}
        aria-label={t("shell.pagesLabel")}
      >
        {pages.map((entry) => (
          <button
            key={entry.id}
            className="nav-item"
            type="button"
            aria-current={navigationPage === entry.id ? "page" : undefined}
            aria-label={t(`shell.pages.${entry.id}`)}
            title={t(`shell.pages.${entry.id}`)}
            disabled={!lab}
            onClick={() => {
              closeMenu();
              navigate({ labId, page: entry.id });
            }}
          >
            <Icon name={entry.icon} size={17} />
            <span className="nav-label">{t(`shell.pages.${entry.id}`)}</span>
          </button>
        ))}
      </nav>
      {lab && labPages.length > 0 && (
        <nav className="sidebar-pages" aria-label={t("shell.labPages")}>
          <p className="eyebrow sidebar-pages-heading">{t("shell.labPages")}</p>
          {labPages.map((record) => (
            <button
              key={record.id}
              type="button"
              className="nav-item sidebar-page"
              aria-current={
                page === "pages" && pageId === record.id ? "page" : undefined
              }
              aria-label={record.title}
              title={record.title}
              onClick={() => {
                closeMenu();
                navigate({ labId, page: "pages", id: record.id });
              }}
            >
              <Icon name="file" size={17} />
              <span className="nav-label sidebar-page-title">
                {record.title}
              </span>
            </button>
          ))}
        </nav>
      )}
      <div className="sidebar-footer">
        <div
          className="sidebar-session"
          role="status"
          aria-label={sessionLabel}
          title={sessionLabel}
        >
          <Logo size={19} />
          <div>
            <strong>{sessionLabel}</strong>
            <small>
              {activity?.known
                ? summaryText(activity)
                : t("shell.researchPartner")}
            </small>
          </div>
          <span
            className={`dot ${session?.streaming ? "busy" : session ? "idle" : ""}`}
          />
        </div>
        <div className="sidebar-tools">
          <button
            className="nav-item"
            type="button"
            aria-label={t("shell.openSettings")}
            title={t("shell.settings")}
            onClick={() => {
              closeMenu();
              onSettings("edit");
            }}
          >
            <Icon name="settings" size={17} />
            <span className="nav-label">{t("shell.settings")}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={t(
              theme === "dark" ? "shell.lightTheme" : "shell.darkTheme",
            )}
            title={t(theme === "dark" ? "shell.lightTheme" : "shell.darkTheme")}
            onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <button
            className="icon-button sidebar-language"
            type="button"
            aria-label={t("shell.switchLanguage")}
            title={t("shell.switchLanguage")}
            onClick={() =>
              setLanguage(currentLanguage() === "en" ? "pt-BR" : "en")
            }
          >
            {t("shell.languageCode")}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        {t("shell.skip")}
      </button>
      <div className={`shell${collapsed ? " sidebar-collapsed" : ""}`}>
        <aside
          className="sidebar desktop-sidebar"
          aria-label={t("shell.navigation")}
        >
          {sidebar(false)}
        </aside>
        <main
          id="main-content"
          className="workspace"
          tabIndex={-1}
          aria-label={pageLabel}
        >
          <header className="topbar">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label={t("shell.openNavigation")}
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => {
                drawer.current?.showModal();
                setMobileOpen(true);
              }}
            >
              <Icon name="menu" size={19} />
            </button>
            <div className="breadcrumbs">
              <button
                type="button"
                className="topbar-lab-switcher"
                onClick={() => setPickerOpen(true)}
                aria-label={t("shell.switchLaboratoryNamed", { name: labName })}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                title={labName}
              >
                <span>{labName}</span>
                <Icon name="chevron" size={11} />
              </button>
              <span className="breadcrumb-divider" aria-hidden="true">
                /
              </span>
              <span className="breadcrumb-page" title={pageLabel}>
                {pageLabel}
              </span>
            </div>
            <div className="topbar-actions">
              {lab && page !== "chat" && onModelChip && (
                <button
                  className="model-chip"
                  type="button"
                  title={t("shell.changeModel")}
                  aria-label={t("shell.changeModel")}
                  onClick={onModelChip}
                >
                  <span>{model}</span>
                  {session?.thinking && session.thinking !== "off" && (
                    <span className="muted">· {session.thinking}</span>
                  )}
                </button>
              )}
              <button
                className="icon-button refresh-button"
                type="button"
                aria-label={t("shell.refresh")}
                title={t("shell.refresh")}
                onClick={onRefresh}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                className="icon-button topbar-theme"
                type="button"
                aria-label={t(
                  theme === "dark" ? "shell.lightTheme" : "shell.darkTheme",
                )}
                title={t(
                  theme === "dark" ? "shell.lightTheme" : "shell.darkTheme",
                )}
                onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
              </button>
              {onChatToggle && (
                <button
                  id="chat-toggle"
                  className="shell-chat-toggle"
                  type="button"
                  onClick={onChatToggle}
                  aria-label={t("shell.converse")}
                  aria-pressed={chatOpen}
                  disabled={!lab}
                >
                  <Icon name="chat" size={16} />
                  <span>{t("shell.converse")}</span>
                </button>
              )}
            </div>
          </header>
          {children}
        </main>
      </div>
      <dialog
        className="sidebar-drawer"
        ref={drawer}
        id="mobile-navigation"
        aria-label={t("shell.navigation")}
        onClose={() => setMobileOpen(false)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <aside className="sidebar" aria-label={t("shell.navigation")}>
          {sidebar(true)}
        </aside>
      </dialog>
      {pickerOpen && (
        <LabSwitcher
          labs={labs}
          labId={labId}
          onClose={() => setPickerOpen(false)}
          onSelect={(id) => {
            setPickerOpen(false);
            closeMenu();
            navigate({ labId: id, page: "chat" });
          }}
          onCreate={() => {
            setPickerOpen(false);
            closeMenu();
            onSettings("new");
          }}
        />
      )}
    </>
  );
}
