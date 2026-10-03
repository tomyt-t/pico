import type { ModelSummary } from "@pico/server/contracts";
import type { RefObject } from "react";
import { useTranslation } from "@/web/components/i18n";
import { Icon, Notice } from "@/web/components/primitives";

const levels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export function MessageComposer({
  draft,
  onDraft,
  textarea,
  working,
  error,
  sending,
  stopping,
  send,
  onStop,
  models,
  model,
  thinking,
  changing,
  onModel,
  onThinking,
  footer,
}: {
  draft: string;
  onDraft: (draft: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  working: boolean;
  error: string | null;
  sending: boolean;
  stopping: boolean;
  send: () => Promise<void>;
  onStop: () => Promise<void>;
  models: ModelSummary[];
  /** "provider/id" of the model in use, or empty when none is available. */
  model: string;
  thinking: string;
  changing: boolean;
  onModel: (value: string) => void;
  onThinking: (value: string) => void;
  footer?: string;
}) {
  const { t } = useTranslation();
  const known = models.some(
    (entry) => `${entry.provider}/${entry.id}` === model,
  );
  return (
    <div className="composer-wrap">
      {error && <Notice error>{error}</Notice>}
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
          title={t("chat.hintPlain")}
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
          <div className="model-pills">
            <label className="model-pill is-model" title={t("chat.modelLabel")}>
              <span className="sr-only">{t("chat.modelLabel")}</span>
              <select
                id="pico-model"
                value={model}
                disabled={changing}
                onChange={(event) => onModel(event.target.value)}
              >
                {!model && <option value="">{t("chat.noModelOption")}</option>}
                {model && !known && <option value={model}>{model}</option>}
                {models.map((entry) => (
                  <option
                    key={`${entry.provider}/${entry.id}`}
                    value={`${entry.provider}/${entry.id}`}
                  >
                    {entry.provider} / {entry.id}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={12} />
            </label>
            <label className="model-pill" title={t("chat.thinkingLabel")}>
              <span className="sr-only">{t("chat.thinkingLabel")}</span>
              <select
                id="pico-thinking"
                value={thinking}
                disabled={changing}
                onChange={(event) => onThinking(event.target.value)}
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {t(`settings.thinkingLevels.${level}`)}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={12} />
            </label>
          </div>
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
            className="primary send-button"
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label={working ? t("chat.sendWhileWorking") : t("chat.send")}
            title={working ? t("chat.sendWhileWorking") : t("chat.send")}
          >
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
      {footer && <p className="chat-footer">{footer}</p>}
    </div>
  );
}
