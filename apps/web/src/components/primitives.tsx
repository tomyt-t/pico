import type { ReactNode } from "react";
import { titleCase } from "@/web/components/format";

export function Icon({
  name,
  size = 18,
}: {
  name:
    | "chat"
    | "overview"
    | "experiment"
    | "library"
    | "sun"
    | "moon"
    | "arrow"
    | "plus"
    | "refresh"
    | "close"
    | "settings"
    | "check";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    chat: (
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
    ),
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    experiment: (
      <>
        <path d="M9 3h6M10 3v6l-6 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-6-9V3M8 14h8" />
      </>
    ),
    library: (
      <>
        <rect x="3" y="3" width="4" height="18" rx="1" />
        <rect x="9" y="3" width="4" height="18" rx="1" />
        <path d="m15 4 4-1 4 17-4 1z" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
      </>
    ),
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6.2 7a7 7 0 0 1 11.6-1L20 9M4 15l2.2 3A7 7 0 0 0 17.8 17" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: (
      <>
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{titleCase(value)}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={error ? "notice error" : "notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Loading({
  children = "Loading laboratory…",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" />
      {children}
    </div>
  );
}
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="subheading">{children}</p>}
      </div>
      {action}
    </header>
  );
}
export function Code({ children }: { children: string }) {
  return (
    <pre className="code">
      <code>{children}</code>
    </pre>
  );
}
