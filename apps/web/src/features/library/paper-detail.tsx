import type { LabOverview, Paper } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
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
  const used = overview.conclusions.filter((conclusion) =>
    conclusion.paperIds.includes(paper.id),
  );
  return (
    <>
      <PageHeading
        eyebrow="Library · paper"
        title={paper.title}
        action={
          <button
            className="primary"
            type="button"
            onClick={() =>
              discuss(
                `Read paper ${paper.id}: ${paper.title}. Help me understand how it relates to our research questions.`,
              )
            }
          >
            Discuss with Pico
          </button>
        }
      >
        {paper.authors.join(", ")}
      </PageHeading>
      <div className="grid-main">
        <Section title="Source text">
          {paper.text ? (
            <div className="paper-text">
              <Markdown>{paper.text}</Markdown>
            </div>
          ) : (
            <Empty title="No source text available">
              This record does not contain the paper's text.
            </Empty>
          )}
        </Section>
        <aside className="stack">
          <Section title="Provenance">
            <dl className="details-grid">
              <div>
                <dt>Source</dt>
                <dd>{paper.source || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Identifier</dt>
                <dd>{paper.identifier || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{timestamp(paper.createdAt)}</dd>
              </div>
              <div>
                <dt>Authorship</dt>
                <dd>{paper.author.kind}</dd>
              </div>
            </dl>
            {externalLink(paper.url) && (
              <p style={{ marginTop: 15 }}>
                <a
                  href={externalLink(paper.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open original source ↗
                </a>
              </p>
            )}
          </Section>
          <Section title="Referenced by conclusions">
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
              <p className="meta">
                No recorded conclusion cites this paper yet.
              </p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
