import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isImportTypeNode,
  isNamedExports,
  isNamedImports,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type Node,
  SyntaxKind,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";

export interface ImportedSymbols {
  from: string;
  specifier: string;
  names: string[];
}

/** The installed TS 7 async API works in Bun; its sync API requires Node pipe internals. */
export async function readImportSymbols(
  root: string,
  project: string,
  files: string[],
): Promise<ImportedSymbols[]> {
  const api = new API({ cwd: root });
  const result: ImportedSymbols[] = [];
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [project] });
    const program = snapshot.getProjects()[0]?.program;
    if (!program) throw new Error(`Missing TypeScript program: ${project}`);
    for (const file of files) {
      const source = await program.getSourceFile(file);
      if (!source) throw new Error(`Missing TypeScript source: ${file}`);
      function visit(node: Node): void {
        if (
          isImportDeclaration(node) &&
          isStringLiteral(node.moduleSpecifier)
        ) {
          const bindings = node.importClause?.namedBindings;
          const names =
            bindings && isNamedImports(bindings)
              ? bindings.elements.map(
                  (element) => (element.propertyName ?? element.name).text,
                )
              : ["*"];
          if (node.importClause?.name) names.push("default");
          result.push({
            from: file,
            specifier: node.moduleSpecifier.text,
            names,
          });
        } else if (
          isExportDeclaration(node) &&
          node.moduleSpecifier &&
          isStringLiteral(node.moduleSpecifier)
        ) {
          const bindings = node.exportClause;
          result.push({
            from: file,
            specifier: node.moduleSpecifier.text,
            names:
              bindings && isNamedExports(bindings)
                ? bindings.elements.map(
                    (element) => (element.propertyName ?? element.name).text,
                  )
                : ["*"],
          });
        } else if (
          isCallExpression(node) &&
          (node.expression.kind === SyntaxKind.ImportKeyword ||
            node.expression.getText() === "require")
        ) {
          const argument = node.arguments[0];
          if (
            argument &&
            (isStringLiteral(argument) ||
              isNoSubstitutionTemplateLiteral(argument))
          )
            result.push({ from: file, specifier: argument.text, names: ["*"] });
        } else if (isImportTypeNode(node)) {
          // A qualified import type still bypasses a restricted, explicit named import.
          const argument = node.argument.getText();
          if (/^["'].*["']$/.test(argument))
            result.push({
              from: file,
              specifier: argument.slice(1, -1),
              names: ["*"],
            });
        }
        node.forEachChild(visit);
      }
      visit(source);
    }
  } finally {
    await api.close();
  }
  return result;
}

export function forbiddenRunnerSymbols(
  imports: ImportedSymbols[],
): ImportedSymbols[] {
  const fileSymbols = new Set([
    "fileAccess",
    "executionControlFiles",
    "RunnerError",
    "FileInput",
    "FileDigest",
    "DatasetManifest",
  ]);
  return imports.filter(
    (entry) =>
      entry.specifier === "@pico/runner" &&
      entry.names.some((name) => !fileSymbols.has(name)),
  );
}
