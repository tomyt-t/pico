import type { LabOverview, Question } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { Status } from "@/web/components/primitives";
import { questionRecords } from "@/web/features/overview/question-records";

export function QuestionRecord({
  row,
  overview,
}: {
  row: Question;
  overview: LabOverview;
}) {
  const own = questionRecords(overview, row.id);
  const latest = own.conclusions.find((entry) => entry.status !== "retracted");
  return (
    <article className="record">
      <div className="record-heading">
        <h3>
          <a
            href={routePath({
              labId: overview.lab.id,
              page: "overview",
              id: row.id,
            })}
          >
            {row.text}
          </a>
        </h3>
        <Status value={row.status} />
      </div>
      {row.context && <p>{row.context}</p>}
      <div className="record-meta">
        <span>{own.hypotheses.length} hypotheses</span>
        <span>{own.experiments.length} experiments</span>
        <span>{own.conclusions.length} conclusions</span>
      </div>
      {latest && (
        <div style={{ marginTop: 12 }}>
          <p className="eyebrow">Latest recorded conclusion</p>
          <p>{latest.statement}</p>
        </div>
      )}
    </article>
  );
}
