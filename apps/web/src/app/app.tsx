import type { Lab } from "@pico/lab/contracts";
import { useEffect, useState } from "react";
import { AppShell } from "@/web/app/app-shell";
import {
  useLaboratories,
  useLaboratoryStatus,
} from "@/web/app/laboratory-queries";
import { navigate, useRoute } from "@/web/app/navigation";
import { savedTheme } from "@/web/app/theme";
import { useTranslation } from "@/web/components/i18n";
import { Loading, Notice } from "@/web/components/primitives";
import { useChatDrafts } from "@/web/features/chat/chat-drafts";
import { Chat } from "@/web/features/chat/chat-page";
import { ExperimentsPage } from "@/web/features/experiments/experiments-page";
import { LibraryPage } from "@/web/features/library/library-page";
import { OverviewPage } from "@/web/features/overview/overview-page";
import { Setup } from "@/web/features/settings/laboratory-setup";
import { Settings } from "@/web/features/settings/settings-dialog";

export function App() {
  const { t, i18n } = useTranslation();
  const labs = useLaboratories();
  const route = useRoute();
  const [theme, setTheme] = useState(savedTheme);
  const [settings, setSettings] = useState<"edit" | "new" | null>(null);
  const labId = route?.labId ?? labs.data?.[0]?.id ?? "";
  const { draft, updateDraft } = useChatDrafts(labId);
  const status = useLaboratoryStatus(labId);
  const lab =
    status.data?.lab ?? labs.data?.find((entry) => entry.id === labId);
  const page = route?.page ?? "chat";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("pico-theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    if (!route && labs.data?.[0])
      navigate({ labId: labs.data[0].id, page: "chat" });
  }, [route, labs.data]);
  const refresh = () => {
    status.refresh();
    labs.refresh();
  };
  const discuss = (text: string) => {
    updateDraft(draft.trim() ? `${draft}\n\n${text}` : text);
    navigate({ labId, page: "chat" });
  };
  const saved = (updated: Lab) => {
    const creating = settings !== "edit";
    setSettings(null);
    refresh();
    if (creating || updated.id !== labId)
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
  if (labs.data?.length === 0 && !route) return <Setup onCreated={saved} />;
  return (
    <>
      <AppShell
        labs={labs.data ?? []}
        labId={labId}
        lab={lab}
        page={page}
        active={status.data?.activeTurn}
        theme={theme}
        onTheme={setTheme}
        onSettings={setSettings}
        onRefresh={refresh}
      >
        {status.error && (
          <Notice error>
            {status.error}{" "}
            <button type="button" onClick={status.refresh}>
              {t("common.retry")}
            </button>
          </Notice>
        )}
        {status.loading && <Loading>{t("common.loadingLaboratory")}</Loading>}
        {lab && page === "chat" && (
          <Chat
            key={labId}
            lab={lab}
            draft={draft}
            onDraft={updateDraft}
            onRefresh={refresh}
          />
        )}
        {lab && page !== "chat" && (
          <div className="page-scroll">
            {page === "overview" ? (
              <OverviewPage
                key={labId}
                labId={labId}
                questionId={route?.id}
                discuss={discuss}
                onRefresh={refresh}
              />
            ) : page === "experiments" ? (
              <ExperimentsPage
                key={labId}
                labId={labId}
                id={route?.id}
                tab={route?.tab}
                discuss={discuss}
                onRefresh={refresh}
              />
            ) : (
              <LibraryPage
                key={labId}
                labId={labId}
                id={route?.id}
                tab={route?.tab}
                discuss={discuss}
                onRefresh={refresh}
              />
            )}
          </div>
        )}
        {!lab && !status.loading && (
          <div className="page">
            <Notice error>{t("app.selectOrCreate")}</Notice>
            <button
              type="button"
              style={{ marginTop: 15 }}
              onClick={() => setSettings("new")}
            >
              {t("app.createLaboratory")}
            </button>
          </div>
        )}
      </AppShell>
      {settings && (
        <Settings
          key={`${settings}-${labId}`}
          lab={settings === "edit" ? lab : undefined}
          onClose={() => setSettings(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}
