import type { Lab } from "@pico/server/contracts";
import {
  type ComponentProps,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AppShell } from "@/web/app/app-shell";
import { CommandPalette } from "@/web/app/command-palette";
import { useLabs, useResearchLine } from "@/web/app/laboratory-queries";
import { navigate, type Route, useRoute } from "@/web/app/navigation";
import {
  clampDockWidth,
  dockWidthRange,
  remember,
  savedDockWidth,
  savedTheme,
} from "@/web/app/theme";
import { useTranslation } from "@/web/components/i18n";
import { Logo } from "@/web/components/logo";
import { Icon, Loading, Notice } from "@/web/components/primitives";
import {
  CampaignActivity,
  useLabActivity,
} from "@/web/features/campaigns/campaign-activity";
import { summarize } from "@/web/features/campaigns/summary";
import { useChatDrafts } from "@/web/features/chat/chat-drafts";
import { Chat } from "@/web/features/chat/chat-page";
import { type LabSendLock, useLabChat } from "@/web/features/chat/use-lab-chat";
import { CollectionPage } from "@/web/features/collection/collection-page";
import { EvolutionPage } from "@/web/features/evolution/evolution-page";
import { ExperimentsPage } from "@/web/features/experiments/experiments-page";
import { FrontsPage } from "@/web/features/fronts/fronts-page";
import { useLabPages } from "@/web/features/pages/page-queries";
import { PagesPage } from "@/web/features/pages/pages-page";
import { AuthorNamesProvider } from "@/web/features/records/authors";
import { Settings } from "@/web/features/settings/settings-dialog";

type ShellProps = Omit<ComponentProps<typeof AppShell>, "children" | "session">;

/** Typing in a field keeps its own shortcuts; only the palette one cuts through. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

/** The dock's left edge: drag it or use the arrow keys to change the width. */
function DockResizer({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <hr
      className="dock-resizer"
      aria-orientation="vertical"
      aria-label={t("shell.resizePanel")}
      aria-valuemin={dockWidthRange.min}
      aria-valuemax={dockWidthRange.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start)
          onResize(clampDockWidth(start.width + start.x - event.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowLeft"
            ? dockWidthRange.step
            : event.key === "ArrowRight"
              ? -dockWidthRange.step
              : 0;
        if (!delta) return;
        event.preventDefault();
        onResize(clampDockWidth(width + delta));
      }}
    />
  );
}

/** The controller stays mounted while the researcher moves between pages. */
function LabWorkspace({
  lab,
  route,
  shell,
  draft,
  onDraft,
  sendLock,
}: {
  lab: Lab;
  route: Route | null;
  shell: ShellProps;
  draft: string;
  onDraft: (text: string, expected?: string) => void;
  sendLock: LabSendLock;
}) {
  const { t } = useTranslation();
  const controller = useLabChat(lab, sendLock);
  const pages = useLabPages(lab.id);
  const researchLine = useResearchLine(lab);
  const activity = useLabActivity(lab.id);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockWidth, setDockWidth] = useState(savedDockWidth);
  const [focusSignal, setFocusSignal] = useState(0);
  const [modelFocus, setModelFocus] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturn = useRef<HTMLElement | null>(null);
  const shortcut = useRef<(event: KeyboardEvent) => void>(() => {});
  const page = shell.page;
  useEffect(() => {
    if (!modelFocus) return;
    // The composer mounts with the dock and focuses its textarea on its own;
    // wait a few frames so the model select ends up focused.
    let timer = 0;
    let attempts = 0;
    const tryFocus = () => {
      const select = document.getElementById("pico-model");
      if (select && document.activeElement !== select) select.focus();
      if ((!select || document.activeElement !== select) && attempts++ < 10)
        timer = window.setTimeout(tryFocus, 32);
    };
    timer = window.setTimeout(tryFocus, 0);
    return () => window.clearTimeout(timer);
  }, [modelFocus]);
  // A new page starts at the top; the scroll container is shared between pages.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only route changes reset the scroll.
  useEffect(() => {
    document.querySelector(".page-scroll")?.scrollTo({ top: 0 });
  }, [route?.page, route?.id, route?.path, route?.tab, route?.kind]);
  useEffect(() => {
    if (route && route.page !== "chat") {
      if (window.matchMedia("(max-width: 1100px)").matches) setDockOpen(false);
      const frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active === document.body || !active?.isConnected)
          document.getElementById("main-content")?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [route]);
  const openDock = () => {
    if (!dockOpen) returnFocus.current = document.activeElement as HTMLElement;
    setDockOpen(true);
    setFocusSignal((previous) => previous + 1);
  };
  const closeDock = () => {
    setDockOpen(false);
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else document.getElementById("chat-toggle")?.focus();
    });
  };
  const discuss = (text: string) => {
    onDraft(draft.trim() ? `${draft}\n\n${text}` : text);
    openDock();
  };
  const changeModel = () => {
    if (!dockOpen) returnFocus.current = document.activeElement as HTMLElement;
    setDockOpen(true);
    setModelFocus((previous) => previous + 1);
  };
  const resizeDock = (width: number) => {
    setDockWidth(width);
    remember("pico-dock-width", String(width));
  };
  const openPalette = () => {
    paletteReturn.current = document.activeElement as HTMLElement | null;
    setPaletteOpen(true);
  };
  const closePalette = () => {
    setPaletteOpen(false);
    const target = paletteReturn.current;
    requestAnimationFrame(() => {
      // The trigger may sit in the closed mobile drawer; the page is the fallback.
      if (
        target &&
        target !== document.body &&
        target.isConnected &&
        target.checkVisibility()
      )
        target.focus();
      else document.getElementById("main-content")?.focus();
    });
  };
  const focusComposer = () => {
    if (page === "chat") document.getElementById("pico-message")?.focus();
    // The composer focuses itself when the dock opens.
    else openDock();
  };
  // ⌘K / Ctrl+K opens the palette; ⌘/ reaches the composer. The handler reads
  // the latest state while the window listener is registered once.
  useLayoutEffect(() => {
    shortcut.current = (event) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "/") return;
      // Another dialog (lab picker, settings, mobile navigation) keeps the keys.
      if (document.querySelector("dialog[open]:not(.palette)")) return;
      if (key === "k") {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen || isTyping(event.target)) return;
      event.preventDefault();
      focusComposer();
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcut.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return (
    <AuthorNamesProvider labId={lab.id}>
      <AppShell
        {...shell}
        pages={pages.pages}
        panorama={pages.panorama}
        pageId={route?.id}
        session={controller.state}
        researchLine={researchLine}
        activity={summarize(activity.campaigns.data, activity.agents.data)}
        onRefresh={() => {
          shell.onRefresh();
          controller.refresh();
          pages.refresh();
          activity.refresh();
        }}
        onChatToggle={
          page === "chat" ? undefined : dockOpen ? closeDock : openDock
        }
        onModelChip={page === "chat" ? undefined : changeModel}
        onSearch={openPalette}
        chatOpen={dockOpen}
      >
        <div
          className={`lab-workspace${page !== "chat" && dockOpen ? " has-chat-dock" : ""}`}
          style={{ "--dock-width": `${dockWidth}px` } as CSSProperties}
        >
          {page !== "chat" && (
            <div className="page-scroll research-page">
              {page === "pages" ||
              page === "panorama" ||
              page === "overview" ? (
                <PagesPage
                  lab={lab}
                  id={route?.id}
                  panorama={page !== "pages"}
                  query={pages}
                  discuss={discuss}
                />
              ) : page === "investigations" ? (
                <FrontsPage lab={lab} id={route?.id} discuss={discuss} />
              ) : page === "collection" ? (
                <CollectionPage
                  lab={lab}
                  id={route?.id}
                  path={route?.path}
                  kind={route?.kind}
                  tab={route?.tab}
                  discuss={discuss}
                />
              ) : page === "evolution" ? (
                <EvolutionPage lab={lab} id={route?.id} discuss={discuss} />
              ) : page === "experiments" ? (
                route?.id ? (
                  <ExperimentsPage lab={lab} id={route.id} discuss={discuss} />
                ) : (
                  <CollectionPage
                    lab={lab}
                    tab="executions"
                    discuss={discuss}
                  />
                )
              ) : page === "library" ? (
                <CollectionPage
                  lab={lab}
                  tab="sources"
                  path={route?.path}
                  discuss={discuss}
                />
              ) : (
                <CollectionPage
                  lab={lab}
                  path={route?.path ?? "."}
                  discuss={discuss}
                />
              )}
            </div>
          )}
          {(page === "chat" || dockOpen) && (
            <section
              className={`chat-pane${page !== "chat" ? " is-dock" : ""}`}
              aria-label={t("chat.panelLabel")}
            >
              {page !== "chat" && (
                <DockResizer width={dockWidth} onResize={resizeDock} />
              )}
              {page !== "chat" && (
                <header className="chat-panel-heading">
                  <Logo size={23} />
                  <strong>{t("chat.panelLabel")}</strong>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t("chat.expandPanel")}
                    title={t("chat.expandPanel")}
                    onClick={() => {
                      setFocusSignal((previous) => previous + 1);
                      navigate({ labId: lab.id, page: "chat" });
                    }}
                  >
                    <Icon name="panel-open" size={16} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t("chat.closePanel")}
                    title={t("chat.closePanel")}
                    onClick={closeDock}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </header>
              )}
              <div className="conversation-layout">
                {page === "chat" && (
                  <CampaignActivity
                    key={lab.id}
                    lab={lab}
                    activity={activity}
                  />
                )}
                <Chat
                  lab={lab}
                  draft={draft}
                  onDraft={onDraft}
                  controller={controller}
                  variant={page === "chat" ? "page" : "dock"}
                  focusSignal={focusSignal || undefined}
                />
              </div>
            </section>
          )}
        </div>
        {paletteOpen && (
          <CommandPalette
            lab={lab}
            labs={shell.labs}
            onClose={closePalette}
            onSettings={shell.onSettings}
          />
        )}
      </AppShell>
    </AuthorNamesProvider>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const labs = useLabs();
  const route = useRoute();
  const [theme, setTheme] = useState(savedTheme);
  const [settings, setSettings] = useState<"edit" | "new" | null>(null);
  useEffect(() => {
    const open = () => setSettings("edit");
    window.addEventListener("pico:settings", open);
    return () => window.removeEventListener("pico:settings", open);
  }, []);
  const [, refreshPendingSends] = useState(0);
  const sendLock = useRef<LabSendLock>({
    labs: new Set(),
    changed: () => refreshPendingSends((previous) => previous + 1),
  });
  const labId = route?.labId ?? labs.data?.[0]?.id ?? "";
  const lab = labs.data?.find((entry) => entry.id === labId);
  const { draft, updateDraft } = useChatDrafts(labId);
  const page = route?.page ?? "chat";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    if (labId) document.getElementById("main-content")?.focus();
  }, [labId]);
  useEffect(() => {
    if (!route && labs.data?.[0])
      navigate({ labId: labs.data[0].id, page: "chat" });
  }, [route, labs.data]);
  const saved = (updated: Lab) => {
    setSettings(null);
    labs.refresh();
    navigate({ labId: updated.id, page: "chat" });
  };
  if (labs.loading && !labs.data)
    return <Loading>{t("app.connecting")}</Loading>;
  if (labs.error && !labs.data)
    return (
      <div className="setup">
        <div className="setup-card">
          <h1>{t("app.cannotConnect")}</h1>
          <Notice error>{labs.error}</Notice>
          <button
            style={{ marginTop: 20 }}
            type="button"
            onClick={labs.refresh}
          >
            {t("app.retryConnection")}
          </button>
        </div>
      </div>
    );
  const shell: ShellProps = {
    labs: labs.data ?? [],
    labId,
    lab,
    page,
    theme,
    onTheme: (value) => {
      // Only an explicit choice is remembered; otherwise the system preference applies.
      setTheme(value);
      remember("pico-theme", value);
    },
    onSettings: setSettings,
    onRefresh: labs.refresh,
  };
  return (
    <>
      {lab ? (
        <LabWorkspace
          key={labId}
          lab={lab}
          route={route}
          shell={shell}
          draft={draft}
          onDraft={updateDraft}
          sendLock={sendLock.current}
        />
      ) : (
        <AppShell {...shell}>
          {!labs.loading && (
            <div className="page empty-lab">
              <Logo size={44} />
              <h1>
                {labs.data?.length
                  ? t("app.selectOrCreate")
                  : t("app.noLabsTitle")}
              </h1>
              <p className="subheading">{t("app.noLabsBody")}</p>
              <button
                type="button"
                className="primary"
                onClick={() => setSettings("new")}
              >
                <Icon name="plus" size={15} />
                {t("app.createLaboratory")}
              </button>
            </div>
          )}
        </AppShell>
      )}
      {settings && (
        <Settings
          key={`${settings}-${labId}`}
          mode={settings}
          lab={settings === "edit" ? lab : undefined}
          onClose={() => setSettings(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}
