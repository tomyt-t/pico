import type { ReactNode } from "react";
import { Loading, Notice } from "@/web/components/primitives";
export function QueryState({
  loading,
  error,
  hasData,
  refresh,
  children,
}: {
  loading: boolean;
  error?: string;
  hasData: boolean;
  refresh: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {error && (
        <Notice error>
          {error}
          {hasData && " Displayed records may be out of date."}{" "}
          <button type="button" className="text-button" onClick={refresh}>
            Retry
          </button>
        </Notice>
      )}
      {loading && <Loading>Loading laboratory records…</Loading>}
      {children}
    </>
  );
}
