import type { LabOverview, Paper } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { author, timestamp } from "@/web/components/format";
import { useTranslation } from "@/web/components/i18n";
import { Markdown } from "@/web/components/markdown";
import { Empty, PageHeading, Section } from "@/web/components/primitives";
import { externalLink } from "@/web/features/library/external-link";

export function PaperDetail({
  paper,
  overview,
  discuss,
}: {
  paper: Paper;
  overview: LabOverview;
  discuss: (text: string) => void;
}) {
  const { t } = useTranslation();
  const used = overview.conclusions.filter((conclusion) =>
    conclusion.paperIds.includes(paper.id),
  );
  return (
    <>
      <PageHeading
        eyebrow={t("paper.eyebrow")}
        title={paper.title}
        action={
          <button
            className="primary"
            type="button"
            onClick={() =>
              discuss(
                t("paper.readPrompt", { id: paper.id, title: paper.title }),
              )
            }
          >
            {t("common.discussWithPico")}
          </button>
        }
      >
        {paper.authors.join(", ")}
      </PageHeading>
      <div className="grid-main">
        <Section title={t("paper.sourceText")}>
          {paper.text ? (
            <div className="paper-text">
              <Markdown>{paper.text}</Markdown>
            </div>
          ) : (
            <Empty title={t("paper.noText")}>{t("paper.noTextBody")}</Empty>
          )}
        </Section>
        <aside className="stack">
          <Section title={t("paper.provenance")}>
            <dl className="details-grid">
              <div>
                <dt>{t("common.source")}</dt>
                <dd>{paper.source || t("common.notRecorded")}</dd>
              </div>
              <div>
                <dt>{t("paper.identifier")}</dt>
                <dd>{paper.identifier || t("common.notRecorded")}</dd>
              </div>
              <div>
                <dt>{t("paper.added")}</dt>
                <dd>{timestamp(paper.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("paper.authorship")}</dt>
                <dd>{author(paper.author.kind)}</dd>
              </div>
            </dl>
            {externalLink(paper.url) && (
              <p style={{ marginTop: 15 }}>
                <a
                  href={externalLink(paper.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("paper.openSource")}
                </a>
              </p>
            )}
          </Section>
          <Section title={t("paper.citedBy")}>
            {used.length ? (
              used.map((conclusion) => (
                <p key={conclusion.id}>
                  <a
                    href={routePath({
                      labId: paper.labId,
                      page: "overview",
                      id: conclusion.questionId,
                    })}
                  >
                    {conclusion.statement}
                  </a>
                </p>
              ))
            ) : (
              <p className="meta">{t("paper.notCited")}</p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
