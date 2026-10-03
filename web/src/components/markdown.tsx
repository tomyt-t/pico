import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { knownLanguage } from "@/web/components/highlight";
import { useTranslation } from "@/web/components/i18n";
import { CodeTokens } from "@/web/components/primitives";
import { headingId, markdownHeadings } from "@/web/features/pages/toc";

/** A blockquote that names its role becomes an aside: a limit to a claim, or a reading note. */
const asideRole =
  /^\s*(limite|limit|limitação|limitation|caveat|atenção|attention|nota|note|como ler|how to read|leitura|reading)\s*[:.]/i;

/** The text inside rendered children, for heading ids. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

export function Markdown({ children }: { children: string }) {
  const { t } = useTranslation();
  // Section headings get ids so a table of contents can reach them. Ids come
  // from the source by line, so re-renders never shift them.
  const byLine = new Map(
    markdownHeadings(children).map((heading) => [heading.line, heading.id]),
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote: ({ children }) => {
            const match = asideRole.exec(textOf(children));
            if (!match) return <blockquote>{children}</blockquote>;
            const warn = /^(limit|caveat|aten|attention)/i.test(match[1] ?? "");
            return (
              <aside className={`aside ${warn ? "is-warn" : "is-note"}`}>
                {children}
              </aside>
            );
          },
          h2: ({ node, children }) => (
            <h2
              id={
                byLine.get(node?.position?.start.line ?? -1) ??
                headingId(textOf(children))
              }
            >
              {children}
            </h2>
          ),
          // Research text may come from the web. Images become links so no
          // remote resource loads before the researcher chooses to open it.
          img: ({ src, alt }) => (
            <a href={src} target="_blank" rel="noopener noreferrer">
              {t("common.openImage", { name: alt || t("common.image") })}
            </a>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const language = knownLanguage(
              /language-([\w-]+)/.exec(className ?? "")?.[1] ?? "",
            );
            return (
              <code className={className}>
                {language && typeof children === "string" ? (
                  <CodeTokens language={language}>
                    {children.replace(/\n$/, "")}
                  </CodeTokens>
                ) : (
                  children
                )}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
