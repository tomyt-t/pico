import type {
  Campaign,
  Job,
  Lab,
  ResearchRecord,
} from "@pico/server/contracts";
import { useEffect, useState } from "react";
import { picoSections } from "@/web/app/laboratory-queries";
import { currentRoute, routePath } from "@/web/app/navigation";
import { excerpt, kindLabel } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { recordHref } from "@/web/components/record-card";
import {
  type Front,
  type FrontState,
  frontLabel,
  frontNumber,
  frontsOf,
} from "@/web/features/fronts/fronts";
import type { Heading } from "@/web/features/pages/toc";

/** The heading currently read: the last one whose top passed the fold. */
function useActiveHeading(ids: string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The ids list is the dependency, by value.
  useEffect(() => {
    const container = document.querySelector(".page-scroll");
    if (!container) return;
    const update = () => {
      const top = container.getBoundingClientRect().top + 96;
      let current: string | undefined;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= top) current = id;
      }
      setActive(current ?? ids[0]);
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [ids.join("\n")]);
  return active;
}

/** The sections of the page, following the scroll. Buttons, not hash links:
 *  the hash is the router's. */
export function PanoramaToc({ headings }: { headings: Heading[] }) {
  const { t } = useTranslation();
  const active = useActiveHeading(headings.map((heading) => heading.id));
  if (headings.length < 2) return <div className="panorama-toc" />;
  return (
    <nav className="panorama-toc" aria-label={t("pages.toc")}>
      <p className="eyebrow">{t("pages.toc")}</p>
      {headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          aria-current={active === heading.id ? "true" : undefined}
          onClick={() =>
            document
              .getElementById(heading.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          {heading.text}
        </button>
      ))}
    </nav>
  );
}

const countOrder: FrontState[] = ["done", "busy", "draft", "new", "superseded"];
const activeCampaign = new Set(["active", "waiting", "pending"]);
const openStatuses = new Set([
  "open",
  "proposed",
  "pending",
  "untested",
  "testing",
  "in_progress",
]);

/** The newest front still moving: the next path when nothing else says so. */
export function nextFront(fronts: Front[]): Front | undefined {
  return fronts.find((front) => ["busy", "draft", "new"].includes(front.state));
}

/** Questions and hypotheses the research has not closed. */
export function openItems(records: ResearchRecord[], limit = 5) {
  return records
    .filter(
      (record) =>
        (record.kind === "question" || record.kind === "hypothesis") &&
        openStatuses.has((record.status ?? "").toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** What the Panorama's margin says: where things stand, the next path, what
 *  stays open and the current direction. Everything comes from records and
 *  laboratory context; the page itself remains the editor's. */
export function PanoramaRail({
  lab,
  records,
  jobs,
  campaigns,
  pico,
  discuss,
}: {
  lab: Lab;
  records: ResearchRecord[];
  jobs: Job[];
  campaigns: Campaign[];
  pico: string;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const fronts = frontsOf(records, jobs);
  const counts = new Map<FrontState, number>();
  for (const front of fronts)
    counts.set(front.state, (counts.get(front.state) ?? 0) + 1);
  const running = campaigns.filter((campaign) =>
    activeCampaign.has(campaign.status),
  ).length;
  const open = openItems(records);
  const next = nextFront(fronts);
  const latest = records
    .filter((record) => record.kind === "conclusion")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const direction = excerpt(picoSections(pico).direction, 320);
  const from = currentRoute();
  const frontsRoute = (tab?: FrontState) =>
    routePath({ labId: lab.id, page: "investigations", tab });
  return (
    <aside className="panorama-rail" aria-label={t("pages.rail.title")}>
      <section className="rail-card">
        <h3>{t("pages.rail.now")}</h3>
        {fronts.length > 0 ? (
          <div className="rail-counts">
            {countOrder
              .filter((state) => counts.get(state))
              .map((state) => (
                <a key={state} href={frontsRoute(state)}>
                  <b>{counts.get(state)}</b>
                  <small>
                    {t(`fronts.statePlural.${state}`).toLowerCase()}
                  </small>
                </a>
              ))}
          </div>
        ) : (
          <p>{t("fronts.empty")}</p>
        )}
        <ul>
          <li>
            <span className={`dot ${running ? "busy" : ""}`} />
            <span>{t("pages.rail.campaigns", { count: running })}</span>
          </li>
          <li>
            <span className={`dot ${open.length ? "pending" : "done"}`} />
            <a href={frontsRoute()}>
              {t("pages.rail.openQuestions", {
                count: records.filter(
                  (record) =>
                    record.kind === "question" && record.status === "open",
                ).length,
              })}
            </a>
          </li>
        </ul>
      </section>
      <section className="rail-card">
        <h3>{t("pages.rail.next")}</h3>
        {next ? (
          <>
            <p className="big">
              <a href={recordHref(next.experiment, from)}>
                {frontNumber(next.experiment)
                  ? next.experiment.title
                  : `${frontLabel(next.experiment)}: ${next.experiment.title}`}
              </a>
            </p>
            <p>
              {next.finding
                ? excerpt(next.finding.body, 160)
                : t(`fronts.state.${next.state}`)}
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                discuss(
                  t("pages.rail.nextRequest", {
                    title: next.experiment.title,
                  }),
                )
              }
            >
              {t("pages.rail.thinkTogether")}
            </button>
          </>
        ) : (
          <>
            <p>
              {latest
                ? t("pages.rail.lastFinding", { title: latest.title })
                : t("pages.rail.noNext")}
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => discuss(t("pages.rail.proposeRequest"))}
            >
              {t("pages.rail.proposeNext")}
            </button>
          </>
        )}
      </section>
      <section className="rail-card">
        <h3 className={open.length ? "warn" : undefined}>
          {t("pages.rail.open")}
        </h3>
        {open.length ? (
          <ul>
            {open.map((record) => (
              <li key={record.id}>
                <span className="dot pending" />
                <a href={recordHref(record, from)}>
                  <small className="muted">{kindLabel(record.kind)}</small>{" "}
                  {record.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("pages.rail.nothingOpen")}</p>
        )}
      </section>
      <section className="rail-card">
        <h3>{t("pages.direction")}</h3>
        <p>{direction || t("overview.directionEmpty")}</p>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("pico:settings", { detail: "edit" }),
            )
          }
        >
          {t("overview.editPico")}
        </button>
      </section>
    </aside>
  );
}
