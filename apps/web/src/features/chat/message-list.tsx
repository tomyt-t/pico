import type { Message } from "@pico/lab/contracts";
import { timestamp } from "@/web/components/format";
import { Markdown } from "@/web/components/markdown";
import { Code, Notice, Status } from "@/web/components/primitives";

export function ChatMessage({ entry }: { entry: Message }) {
  if (entry.toolCall)
    return (
      <details className="tool-call">
        <summary>
          <strong className="mono">{entry.toolCall.name}</strong>
          <span>
            <Status value={entry.toolCall.status} />
          </span>
        </summary>
        <p className="eyebrow" style={{ marginTop: 15 }}>
          Input
        </p>
        <Code>{JSON.stringify(entry.toolCall.arguments, null, 2)}</Code>
        {entry.toolCall.result !== undefined && (
          <>
            <p className="eyebrow" style={{ marginTop: 15 }}>
              Output
            </p>
            <Code>{JSON.stringify(entry.toolCall.result, null, 2)}</Code>
          </>
        )}
        {entry.toolCall.error && <Notice error>{entry.toolCall.error}</Notice>}
      </details>
    );
  return (
    <article className={`message message-${entry.role}`}>
      <header className="message-header">
        <strong>
          {entry.role === "assistant"
            ? "Pico"
            : entry.role === "user"
              ? "You"
              : "Laboratory"}
        </strong>
        <time dateTime={entry.createdAt}>{timestamp(entry.createdAt)}</time>
      </header>
      <div className="message-body">
        {entry.role === "assistant" ? (
          <Markdown>{entry.content}</Markdown>
        ) : (
          entry.content
        )}
      </div>
    </article>
  );
}
