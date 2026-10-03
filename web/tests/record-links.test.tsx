import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, routePath } from "@/web/app/navigation";
import { statusLabel } from "@/web/components/format";
import { i18n } from "@/web/components/i18n";
import { Status } from "@/web/components/primitives";
import { KindLink, LinkChips } from "@/web/components/record-card";

describe("record navigation", () => {
  test("a reference outside the loaded result still opens its scoped detail", async () => {
    const previous = i18n.language;
    try {
      for (const language of ["pt-BR", "en"] as const) {
        await i18n.changeLanguage(language);
        const html = renderToStaticMarkup(
          <LinkChips
            labId="meu lab"
            known={new Set(["p-loaded"])}
            links={[
              { kind: "paper", id: "p-unloaded", title: "Fonte anterior" },
              { kind: "paper", id: "p-loaded" },
              { kind: "job", id: "job-1" },
            ]}
          />,
        );
        expect(html).toContain(
          `href="${routePath({ labId: "meu lab", page: "collection", id: "p-unloaded" })}"`,
        );
        expect(html).toContain(`title="${i18n.t("record.notLoaded")}"`);
        expect(html).toContain("Fonte anterior");
        expect(html.match(/class="pill-link missing"/g)).toHaveLength(1);
        expect(html.match(/<a /g)).toHaveLength(3);
        expect(html).not.toContain("inexistente");
        expect(html).toContain(
          routePath({ labId: "meu lab", page: "experiments", id: "job-1" }),
        );
      }
    } finally {
      await i18n.changeLanguage(previous);
    }
  });

  test("category counters open the collection with the corresponding kind", () => {
    for (const kind of [
      "note",
      "hypothesis",
      "conclusion",
      "paper",
      "dataset",
    ]) {
      const html = renderToStaticMarkup(
        <KindLink labId="lab" kind={kind} count={2} />,
      );
      const href = html.match(/href="([^"]+)"/)?.[1];
      expect(parseRoute(href ?? "")).toEqual({
        labId: "lab",
        page: "collection",
        kind,
      });
    }
    const html = renderToStaticMarkup(
      <KindLink labId="lab" kind="question" count={1} />,
    );
    expect(html).toContain(routePath({ labId: "lab", page: "investigations" }));
  });

  test("statuses the model writes freely are shown as written, known ones translated", async () => {
    const previous = i18n.language;
    try {
      await i18n.changeLanguage("pt-BR");
      expect(statusLabel("resolved")).toBe("Resolvida");
      expect(statusLabel("saved")).toBe("Salvo");
      expect(statusLabel("failed")).toBe("Falhou");
      expect(statusLabel("Em_Andamento")).toBe("em andamento");
      expect(statusLabel("needs review")).toBe("needs review");
      await i18n.changeLanguage("en");
      expect(statusLabel("blocked")).toBe("Blocked");
      expect(statusLabel("Em_Andamento")).toBe("em andamento");
    } finally {
      await i18n.changeLanguage(previous);
    }
    expect(renderToStaticMarkup(<Status value="resolved" />)).toContain(
      'class="status status-resolved"',
    );
    const free = renderToStaticMarkup(<Status value="Needs review/2" />);
    expect(free).toContain('class="status status-needs-review-2"');
    expect(free).toContain(">needs review/2<");
  });
});
