import { afterEach, describe, expect, test } from "bun:test";
import type { Lab, LabContext } from "@pico/server/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/web/app/app-shell";
import { LabSwitcher } from "@/web/app/lab-switcher";
import { researchLineFrom } from "@/web/app/laboratory-queries";
import {
  clampDockWidth,
  savedDockWidth,
  savedSidebar,
  savedTheme,
  systemTheme,
} from "@/web/app/theme";

const at = "2026-09-30T12:00:00Z";
const lab: Lab = {
  id: "lab-a",
  name: "Pesquisa A",
  path: "/labs/a",
  researchLine: "",
  provider: null,
  model: null,
  thinking: "off",
  createdAt: at,
  updatedAt: at,
};

const renderShell = (extra: Partial<Parameters<typeof AppShell>[0]> = {}) =>
  renderToStaticMarkup(
    <AppShell
      labs={[lab]}
      labId={lab.id}
      lab={lab}
      page="panorama"
      theme="dark"
      onTheme={() => {}}
      onSettings={() => {}}
      onRefresh={() => {}}
      {...extra}
    >
      <p>Conteúdo</p>
    </AppShell>,
  );

const file = (content: string | null): LabContext => ({
  content: content ?? "",
  revision: 1,
  updatedAt: at,
});

describe("shell labels", () => {
  test("legacy routes are labelled by the navigation page they belong to", () => {
    for (const page of ["library", "files"] as const) {
      const html = renderShell({ page });
      expect(html).toContain('aria-label="Acervo"');
      expect(html).toContain('class="breadcrumb-page" title="Acervo">Acervo<');
    }
    // Experiments and results are fronts; a job opened from elsewhere keeps that page lit.
    expect(renderShell({ page: "experiments" })).toContain(
      'class="breadcrumb-page" title="Frentes">Frentes<',
    );
    expect(renderShell({ page: "overview" })).toContain(
      'class="breadcrumb-page" title="Panorama">Panorama<',
    );
    expect(renderShell({ page: "collection" })).toContain(
      'class="breadcrumb-page" title="Acervo">Acervo<',
    );
  });

  test("the model chip opens the conversation and disappears on the chat page", () => {
    const chip = 'class="model-chip"';
    const html = renderShell({ onModelChip: () => {} });
    const tag = /<button class="model-chip"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('title="Trocar modelo ou raciocínio"');
    expect(tag).not.toContain("Abrir configurações");
    expect(renderShell({ page: "chat", onModelChip: () => {} })).not.toContain(
      chip,
    );
    expect(renderShell()).not.toContain(chip);
  });

  test("the research line is a subtitle only when there is one", () => {
    expect(renderShell()).not.toContain("<small>Nasce");
    expect(renderShell()).not.toMatch(
      /lab-identity-copy"><strong>[^<]*<\/strong><small>/,
    );
    expect(renderShell({ researchLine: "Defesa multimodal" })).toContain(
      "<small>Defesa multimodal</small>",
    );
    const picker = (researchLine: string) =>
      renderToStaticMarkup(
        <LabSwitcher
          labs={[{ ...lab, researchLine }]}
          labId={lab.id}
          onClose={() => {}}
          onSelect={() => {}}
          onCreate={() => {}}
        />,
      );
    expect(picker("")).not.toMatch(
      /lab-picker-copy"><strong>[^<]*<\/strong><small>/,
    );
    expect(picker("Futebol e dados")).toContain(
      "<small>Futebol e dados</small>",
    );
  });
});

describe("research line from database context", () => {
  test("reads the section, strips Markdown and ignores the template placeholder", () => {
    const markdown = [
      "# Lab",
      "",
      "## Linha de pesquisa",
      "",
      "Defesas **multimodais** contra _ataques_ adversariais em modelos de visão e linguagem, com foco em avaliação reproduzível.",
      "",
      "## Direção atual",
      "- algo",
    ].join("\n");
    const line = researchLineFrom(file(markdown));
    expect(line.startsWith("Defesas multimodais contra ataques")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(90);
    expect(line.endsWith("…")).toBe(true);
    expect(
      researchLineFrom(
        file("# Lab\n\n## Research line\n\nShort line.\n\n## Other\n"),
      ),
    ).toBe("Short line.");
    expect(
      researchLineFrom(
        file(
          "# Lab\n\n## Linha de pesquisa\n\n(a definir na conversa: comece explorando ideias)\n",
        ),
      ),
    ).toBe("");
    expect(researchLineFrom(file("# Lab\n\n## Direção atual\n\n- x"))).toBe("");
    expect(researchLineFrom(file(null))).toBe("");
    expect(researchLineFrom(undefined)).toBe("");
  });
});

describe("remembered preferences", () => {
  const scope = globalThis as { window?: unknown };
  afterEach(() => {
    Reflect.deleteProperty(scope, "window");
  });

  test("the theme follows the system when nothing is stored", () => {
    expect(systemTheme()).toBe("dark");
    scope.window = { matchMedia: () => ({ matches: false }) };
    expect(systemTheme()).toBe("light");
    expect(savedTheme()).toBe("light");
    scope.window = { matchMedia: () => ({ matches: true }) };
    expect(savedTheme()).toBe("dark");
  });

  test("sidebar and dock defaults apply without storage", () => {
    expect(savedSidebar()).toBe("expanded");
    expect(savedDockWidth()).toBe(400);
    expect(clampDockWidth(100)).toBe(360);
    expect(clampDockWidth(900)).toBe(640);
    expect(clampDockWidth(480)).toBe(480);
    expect(clampDockWidth(Number.NaN)).toBe(400);
  });
});
