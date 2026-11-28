import ts from "typescript";
import type { AstIndexData } from "@repospec/plugin";
import { isSecretEnvName } from "@repospec/plugin";

function isEnvObjectExpr(expr: ts.Expression, sf: ts.SourceFile): boolean {
  const t = expr.getText(sf);
  return t === "process.env" || t === "Bun.env" || t === "import.meta.env";
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
