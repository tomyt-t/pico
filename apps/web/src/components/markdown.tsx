import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { knownLanguage } from "@/web/components/highlight";
import { useTranslation } from "@/web/components/i18n";
import {
  LinkedRecordText,
  type RecordLinks,
} from "@/web/components/linked-record-text";
import { CodeTokens } from "@/web/components/primitives";
export function Markdown({
  children,
  links,
}: {
  children: string;
  links?: RecordLinks;
}) {
  const { t } = useTranslation();
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p>
              <LinkedRecordText links={links}>{children}</LinkedRecordText>
            </p>
          ),
          li: ({ children }) => (
            <li>
              <LinkedRecordText links={links}>{children}</LinkedRecordText>
            </li>
          ),
          td: ({ children }) => (
            <td>
              <LinkedRecordText links={links}>{children}</LinkedRecordText>
            </td>
          ),
          // Research text is untrusted. Even an image can transmit its URL's
          // contents before the researcher chooses to open a source.
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
