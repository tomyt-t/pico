import type { ReactNode } from "react";
import { useTranslation } from "@/web/components/i18n";
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
  const { t } = useTranslation();
  return (
    <>
      {error && (
        <Notice error>
          {error}
          {hasData && ` ${t("common.outOfDate")}`}{" "}
          <button type="button" className="text-button" onClick={refresh}>
            {t("common.retry")}
          </button>
        </Notice>
      )}
      {loading && <Loading>{t("common.loadingRecords")}</Loading>}
      {children}
    </>
  );
}
