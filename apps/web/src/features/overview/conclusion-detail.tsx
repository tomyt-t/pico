import type { Conclusion, LabOverview } from "@pico/lab/contracts";
import { routePath } from "@/web/app/navigation";
import { timestamp } from "@/web/components/format";
import { Status } from "@/web/components/primitives";

export function ConclusionRecord({
  row,
  overview,
}: {
  row: Conclusion;
  overview: LabOverview;
}) {
  return (
    <article className="record">
      <div className="record-heading">
        <h3>{row.statement}</h3>
        <Status value={row.status} />
      </div>
      <div className="record-meta">
        <span>{row.confidence} confidence</span>
        <time dateTime={row.createdAt}>{timestamp(row.createdAt)}</time>
        <span>By {row.author.kind === "pico" ? "Pico" : row.author.kind}</span>
      </div>
      {row.limitations && (
        <p style={{ marginTop: 10 }}>
          <strong>Limitations:</strong> {row.limitations}
        </p>
      )}
      <div className="link-list">
        {row.resultIds.map((id) => {
          const result = overview.results.find((entry) => entry.id === id);
          return result ? (
            <a
              key={id}
              href={routePath({
                labId: overview.lab.id,
                page: "experiments",
                id: result.experimentId,
              })}
            >
              Analysis of {result.runIds.length} run
              {result.runIds.length === 1 ? "" : "s"}
            </a>
          ) : (
            <span className="meta" key={id}>
              Analysis {id}
            </span>
          );
        })}
        {row.paperIds.map((id) => (
          <a
            key={id}
            href={routePath({ labId: overview.lab.id, page: "library", id })}
          >
            {overview.papers.find((entry) => entry.id === id)?.title ??
              "Referenced paper"}
          </a>
        ))}
      </div>
    </article>
  );
}
