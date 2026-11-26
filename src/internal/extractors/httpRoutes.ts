import ts from "typescript";
import type { HttpEndpointFact } from "../../schema.ts";

const HTTP_METHOD_LITERAL_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;

function isPathnameExpression(expr: ts.Expression, sf: ts.SourceFile): boolean {
  const txt = expr.getText(sf).trim();
  return txt === "pathname" || txt.endsWith(".pathname");
}

function isMethodExpression(expr: ts.Expression, sf: ts.SourceFile): boolean {
  const txt = expr.getText(sf).trim();
  return txt === "method" || txt.endsWith(".method");
}

function regexLiteralToRoutePath(patternText: string): string | null {
  const clean = patternText.replace(/^\/|\/[a-z]*$/g, "").replace(/^\^/, "").replace(/\$$/, "");
  const unescaped = clean.replace(/\\\//g, "/");
  if (!unescaped.startsWith("/")) return null;
  const normalized = unescaped
    .replace(/\(\?<([a-zA-Z0-9_]+)>[^)]+\)/g, ":$1")
    .replace(/\([^)]+\)/g, ":param")
    .replace(/\[[^\]]+\]\+?/g, ":param")
    .replace(/\\w\+/g, ":param")
    .replace(/\\d\+/g, ":id")
    .replace(/\?\s*$/, "");
  return normalized.startsWith("/") ? normalized : null;
}

function collectConditionInfo(
  cond: ts.Expression,
  sf: ts.SourceFile,
): { methods: string[]; paths: Array<{ path: string; line: number }> } {
  const methods = new Set<string>();
  const paths: Array<{ path: string; line: number }> = [];

  const scan = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
      const checkPair = (a: ts.Expression, b: ts.Expression): void => {
        if (isMethodExpression(a, sf) && ts.isStringLiteral(b) && HTTP_METHOD_LITERAL_RE.test(b.text)) {
          methods.add(b.text.toUpperCase());
        }
        if (isPathnameExpression(a, sf) && ts.isStringLiteral(b) && b.text.startsWith("/")) {
          paths.push({ path: b.text, line: sf.getLineAndCharacterOfPosition(b.getStart(sf)).line + 1 });
        }
      };
      checkPair(node.left, node.right);
      checkPair(node.right, node.left);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const prop = node.expression.name.text;
      const recv = node.expression.expression;
      const arg0 = node.arguments[0];
      if ((prop === "startsWith" || prop === "endsWith") && isPathnameExpression(recv, sf) && arg0 && ts.isStringLiteral(arg0) && arg0.text.startsWith("/")) {
        const suffix = prop === "startsWith" && !arg0.text.endsWith("*") ? `${arg0.text.replace(/\/$/, "")}/*` : arg0.text;
        paths.push({ path: suffix, line: sf.getLineAndCharacterOfPosition(arg0.getStart(sf)).line + 1 });
      }
      if (prop === "match" && isPathnameExpression(recv, sf) && arg0 && ts.isRegularExpressionLiteral(arg0)) {
        const p = regexLiteralToRoutePath(arg0.text);
        if (p) paths.push({ path: p, line: sf.getLineAndCharacterOfPosition(arg0.getStart(sf)).line + 1 });
      }
      if (prop === "test" && ts.isRegularExpressionLiteral(recv) && arg0 && isPathnameExpression(arg0, sf)) {
        const p = regexLiteralToRoutePath(recv.text);
        if (p) paths.push({ path: p, line: sf.getLineAndCharacterOfPosition(recv.getStart(sf)).line + 1 });
      }
    }

    ts.forEachChild(node, scan);
  };

  scan(cond);
  return { methods: Array.from(methods), paths };
}

function collectRoutesFromBody(
  rootNode: ts.Node,
  sf: ts.SourceFile,
  unitName: string,
  relFile: string,
  out: HttpEndpointFact[],
  seen: Set<string>,
): void {
  const pushRoute = (method: string, routePath: string, line: number): void => {
    const key = `${method}|${routePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      unit: unitName,
      method,
      path: routePath,
      authGuard: null,
      source: "ast",
      resolution: "mounted",
      handlerFile: relFile,
      line,
      operationId: null,
    });
  };

  const walk = (node: ts.Node, inheritedMethods: string[]): void => {
    if (ts.isIfStatement(node)) {
      const info = collectConditionInfo(node.expression, sf);
      const effectiveMethods = info.methods.length > 0 ? info.methods : inheritedMethods;
      const emitMethods = effectiveMethods.length > 0 ? effectiveMethods : ["ANY"];
      for (const p of info.paths) {
        for (const m of emitMethods) pushRoute(m, p.path, p.line);
      }
      walk(node.thenStatement, effectiveMethods);
      if (node.elseStatement) walk(node.elseStatement, inheritedMethods);
      return;
    }

    if (ts.isSwitchStatement(node) && isPathnameExpression(node.expression, sf)) {
      const emitMethods = inheritedMethods.length > 0 ? inheritedMethods : ["ANY"];
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression) && clause.expression.text.startsWith("/")) {
          const line = sf.getLineAndCharacterOfPosition(clause.expression.getStart(sf)).line + 1;
          for (const m of emitMethods) pushRoute(m, clause.expression.text, line);
        }
      }
      return;
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "match" && isPathnameExpression(call.expression.expression, sf)) {
        const arg0 = call.arguments[0];
        if (arg0 && ts.isRegularExpressionLiteral(arg0)) {
          const p = regexLiteralToRoutePath(arg0.text);
          if (p) {
            const line = sf.getLineAndCharacterOfPosition(arg0.getStart(sf)).line + 1;
            const emitMethods = inheritedMethods.length > 0 ? inheritedMethods : ["ANY"];
            for (const m of emitMethods) pushRoute(m, p, line);
          }
        }
      }
    }

    ts.forEachChild(node, (child) => walk(child, inheritedMethods));
  };

  walk(rootNode, []);
}

export function extractBunServeEndpoints(
  sf: ts.SourceFile,
  unitName: string,
  relFile: string,
): HttpEndpointFact[] {
  let hasBunServe = false;
  const fetchRoots: ts.Node[] = [];
  const referencedHandlerNames = new Set<string>();
  const localFunctions = new Map<string, ts.Node>();

  const scanTop = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      localFunctions.set(node.name.text, node.body);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        localFunctions.set(node.name.text, node.initializer.body);
      } else if (ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)) {
        const factoryName = node.initializer.expression.text;
        const factoryBody = localFunctions.get(factoryName);
        if (factoryBody) localFunctions.set(node.name.text, factoryBody);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const recv = node.expression.expression.getText(sf);
      const prop = node.expression.name.text;
      if (recv === "Bun" && prop === "serve") {
        hasBunServe = true;
        const arg0 = node.arguments[0];
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          for (const p of arg0.properties) {
            if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === "fetch" && p.body) {
              fetchRoots.push(p.body);
            } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "fetch") {
              if (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)) {
                fetchRoots.push(p.initializer.body);
              } else if (ts.isIdentifier(p.initializer)) {
                referencedHandlerNames.add(p.initializer.text);
              } else if (ts.isCallExpression(p.initializer) && ts.isIdentifier(p.initializer.expression)) {
                referencedHandlerNames.add(p.initializer.expression.text);
              }
            } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === "fetch") {
              referencedHandlerNames.add("fetch");
            }
          }
        }
      }
    }
    ts.forEachChild(node, scanTop);
  };

  scanTop(sf);
  if (!hasBunServe) return [];

  for (const name of referencedHandlerNames) {
    const fnBody = localFunctions.get(name);
    if (fnBody) fetchRoots.push(fnBody);
  }
  if (fetchRoots.length === 0) fetchRoots.push(sf);

  const out: HttpEndpointFact[] = [];
  const seen = new Set<string>();
  for (const root of fetchRoots) {
    collectRoutesFromBody(root, sf, unitName, relFile, out, seen);
  }
  return out;
}
