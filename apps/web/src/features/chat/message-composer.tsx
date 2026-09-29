import type { Lab } from "@pico/lab/contracts";
import type { RefObject } from "react";
import { Trans, useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";
export function MessageComposer({
  lab,
  draft,
  onDraft,
  textarea,
  working,
  error,
  sending,
  stopping,
  connected,
  send,
  onStop,
}: {
  lab: Lab;
  draft: string;
  onDraft: (draft: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  working: boolean;
  error: string | null;
  sending: boolean;
  stopping: boolean;
  connected: boolean;
  send: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="composer-wrap">
      {error && (
        <Notice error>
          {error} {t("chat.draftKept")}
        </Notice>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="pico-message">
          {t("chat.messageLabel")}
        </label>
        <textarea
          id="pico-message"
          ref={textarea}
          placeholder={
            working ? t("chat.placeholderWorking") : t("chat.placeholderIdle")
          }
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-bottom">
          <span className="composer-hint">
            <Trans i18nKey="chat.hint" components={{ kbd: <kbd /> }} />
          </span>
          {working && (
            <button
              type="button"
              className="small stop-button"
              disabled={stopping}
              onClick={onStop}
            >
              <Icon name="stop" size={13} />
              {stopping ? t("chat.stopping") : t("chat.stop")}
            </button>
          )}
          <button
            className="primary small"
            type="submit"
            disabled={!draft.trim() || sending || !connected}
          >
            {sending
              ? t("chat.sending")
              : working
                ? t("chat.enqueue")
                : t("chat.send")}
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </form>
      <p className="chat-footer">
        {lab.settings.provider.mode === "demo"
          ? t("chat.footerDemo")
          : t("chat.footerModel", {
              model: lab.settings.provider.model || t("chat.externalModel"),
            })}
      </p>
    </div>
  );
}
