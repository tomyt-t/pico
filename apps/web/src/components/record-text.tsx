import { type CSSProperties, useEffect, useRef, useState } from "react";
import { shortId } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";

const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function abbreviateIds(text: string): string {
  return text.replace(uuid, shortId);
}

export function IdText({ children }: { children: string }) {
  const parts = children.split(uuid);
  const ids = children.match(uuid) ?? [];
  return (
    <>
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Fragments of one immutable string keep their order.
        <span key={index}>
          {part}
          {ids[index] && (
            <span className="id-chip" title={ids[index]}>
              {shortId(ids[index])}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

export function ClampedText({
  children,
  lines = 4,
  className,
}: {
  children: string;
  lines?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = text.current;
    if (!element || open) return;
    const measure = () =>
      setLong(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  return (
    <>
      <p
        ref={text}
        className={[className, !open && "clamp"].filter(Boolean).join(" ")}
        style={{ "--lines": lines } as CSSProperties}
      >
        <IdText>{children}</IdText>
      </p>
      {(long || open) && (
        <button
          type="button"
          className="text-button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t("common.showLess") : t("common.readMore")}
        </button>
      )}
    </>
  );
}

export function Hash({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="hash">
      <code title={value}>
        {value.match(uuid)?.[0] === value
          ? shortId(value)
          : value.length > 20
            ? `${value.slice(0, 10)}…${value.slice(-6)}`
            : value}
      </code>
      <button
        type="button"
        aria-label={t("common.copyValue", { value })}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </span>
  );
}
