import ts from "typescript";
import type { AstIndexData, FactEdgeRecord } from "@repospec/plugin";
import { isSecretEnvName } from "@repospec/plugin";

function isEnvObjectExpr(expr: ts.Expression, sf: ts.SourceFile): boolean {
  const t = expr.getText(sf);
  return t === "process.env" || t === "Bun.env" || t === "import.meta.env";
}

export function collectTsSymbolImports(params: {
  node: ts.ImportDeclaration | ts.ExportDeclaration;
  fromFile: string;
  toFile: string;
  line: number;
  factEdges: FactEdgeRecord[];
}): void {
  const { node, fromFile, toFile, line, factEdges } = params;
  const pushSym = (symbol: string): void => {
    factEdges.push({
      extractorId: "arch.code-ast.v5",
      kind: "imports_symbol",
      fromRef: fromFile,
      toRef: toFile,
      file: fromFile,
      line,
      payload: { symbol },
    });
  };
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return;
    if (clause.name) pushSym("default");
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ts.isNamespaceImport(bindings)) {
      pushSym("*");
    } else if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        pushSym(el.propertyName ? el.propertyName.text : el.name.text);
      }
    }
    return;
  }
  const expClause = node.exportClause;
  if (!expClause) {
    pushSym("*");
  } else if (ts.isNamespaceExport(expClause)) {
    pushSym("*");
  } else if (ts.isNamedExports(expClause)) {
    for (const el of expClause.elements) {
      pushSym(el.propertyName ? el.propertyName.text : el.name.text);
    }
  }
}

export function collectTsEnvRead(params: {
  node: ts.Node;
  sf: ts.SourceFile;
  rel: string;
  unitName: string;
  isTest: boolean;
  ast: AstIndexData;
}): void {
  const { node, sf, rel, unitName, isTest, ast } = params;
  if (isTest) return;

  const pushEnv = (envName: string, pos: number): void => {
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(envName)) return;
    ast.envBindings.push({
      envName,
      sourceKind: "code_read",
      unit: unitName,
      file: rel,
      line: sf.getLineAndCharacterOfPosition(pos).line + 1,
      isSecret: isSecretEnvName(envName),
    });
  };

  if (ts.isPropertyAccessExpression(node) && isEnvObjectExpr(node.expression, sf)) {
    pushEnv(node.name.text, node.getStart(sf));
    return;
  }

  if (
    ts.isElementAccessExpression(node) &&
    isEnvObjectExpr(node.expression, sf) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    pushEnv(node.argumentExpression.text, node.getStart(sf));
    return;
  }

  if (
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer &&
    isEnvObjectExpr(node.initializer, sf)
  ) {
    for (const el of node.name.elements) {
      const propName =
        el.propertyName && (ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName))
          ? el.propertyName.text
          : ts.isIdentifier(el.name)
            ? el.name.text
            : "";
      if (propName) pushEnv(propName, el.getStart(sf));
    }
  }
}
