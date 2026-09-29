import type { Lab, Turn } from "@pico/lab/contracts";
import type { ReactNode } from "react";
import { navigate, type Page } from "@/web/app/navigation";
import { Icon } from "@/web/components/primitives";
export const pages: {
  id: Page;
  label: string;
  icon: "chat" | "overview" | "experiment" | "library";
}[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "experiments", label: "Experiments", icon: "experiment" },
  { id: "library", label: "Library", icon: "library" },
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
        Skip to workspace
      </button>
      <div className="shell">
        <aside className="sidebar" aria-label="Laboratory navigation">
          <div className="brand">
            <span className="pico-mark">p</span>Pico
          </div>
          <div className="lab-switcher">
            <label htmlFor="lab-switch" className="eyebrow">
              Laboratory
            </label>
            <select
              id="lab-switch"
              value={labId}
              onChange={(event) =>
                navigate({ labId: event.target.value, page: "chat" })
              }
            >
              {!labs?.some((entry) => entry.id === labId) && (
                <option value={labId}>Unknown laboratory</option>
              )}
              {labs?.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <button
              className="text-button meta"
              type="button"
              onClick={() => onSettings("new")}
            >
              + New laboratory
            </button>
          </div>
          <nav aria-label="Pages">
            {pages.map((entry) => (
              <button
                key={entry.id}
                className="nav-item"
                type="button"
                aria-current={page === entry.id ? "page" : undefined}
                onClick={() => navigate({ labId, page: entry.id })}
              >
                <Icon name={entry.icon} />
                <span>{entry.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-detail">
            <p className="eyebrow">Research direction</p>
            <p>
              {lab?.researchLine ||
                "A direction will take shape in your conversation with Pico."}
            </p>
            <p className="meta">
              One main conversation.
              <br />A shared record of the research.
            </p>
          </div>
          <div className="sidebar-footer">
            <span className="session-indicator">
              <span className={`dot ${active ? "busy" : ""}`} />
              {active ? `Pico · ${active.status}` : "Pico · idle"}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => onSettings("edit")}
              disabled={!lab}
              aria-label="Laboratory settings"
            >
              <Icon name="settings" size={17} />
            </button>
          </div>
        </aside>
        <main
          id="main-content"
          className="workspace"
          tabIndex={-1}
          aria-label={`${pages.find((entry) => entry.id === page)?.label ?? "Laboratory"} workspace`}
        >
          <header className="topbar">
            <div className="breadcrumbs">
              <strong>{lab?.name ?? "Laboratory"}</strong>
              <span>/</span>
              <span>{pages.find((entry) => entry.id === page)?.label}</span>
            </div>
            <div className="topbar-actions">
              <span
                className="meta"
                title={
                  lab?.settings.provider.mode === "pi"
                    ? `Pi · ${lab.settings.provider.provider ?? "provider"} / ${lab.settings.provider.model}`
                    : lab?.settings.provider.model
                }
                style={{
                  maxWidth: 300,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lab?.settings.provider.mode === "demo"
                  ? "Demonstration"
                  : lab?.settings.provider.mode === "pi"
                    ? `Pi · ${lab.settings.provider.provider ?? "provider"} / ${lab.settings.provider.model}`
                    : lab?.settings.provider.model}
              </span>
              <button
                className="icon-button"
                type="button"
                aria-label="Refresh laboratory"
                onClick={onRefresh}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Open laboratory settings"
                onClick={() => onSettings("edit")}
                disabled={!lab}
              >
                <Icon name="settings" size={17} />
              </button>
            </div>
          </header>
          {lab?.settings.provider.mode === "demo" && (
            <div className="notice demo" role="status">
              Demonstration model: narration is simulated; tools create real
              records.
              {!lab.settings.executionEnabled && (
                <>
                  {" "}
                  Local execution is off.{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onSettings("edit")}
                  >
                    Settings
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
