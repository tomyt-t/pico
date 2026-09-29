import type { Lab } from "@pico/lab/contracts";
import type { RefObject } from "react";
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
  return (
    <div className="composer-wrap">
      {error && (
        <Notice error>
          {error} Your draft is kept. Retrying uses the same request.
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
          Message Pico
        </label>
        <textarea
          id="pico-message"
          ref={textarea}
          placeholder={
            working
              ? "Prepare your next thought while Pico works…"
              : "Discuss your research with Pico…"
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
            One conversation · Shift + Enter for a new line
          </span>
          {working ? (
            <button
              type="button"
              className="small"
              disabled={stopping}
              onClick={onStop}
            >
              Stop Pico's turn
            </button>
          ) : (
            <button
              className="primary small"
              type="submit"
              disabled={!draft.trim() || sending || !connected}
            >
              {sending ? "Sending…" : "Send"}
              <Icon name="arrow" size={15} />
            </button>
          )}
        </div>
      </form>
      <p className="chat-footer">
        {lab.settings.provider.mode === "demo"
          ? "Demonstration model · simulated narration, real laboratory records"
          : `${lab.settings.provider.model || "External model"} · conclusions stay linked to their evidence`}
      </p>
    </div>
  );
}
