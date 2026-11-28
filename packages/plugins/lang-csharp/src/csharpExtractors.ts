import type { AstIndexData, CanonicalLayer, LoopRecord } from "@repospec/plugin";
import { isSecretEnvName } from "@repospec/plugin";
import { lineOf } from "./csharpHelpers.ts";
import { extractBalancedBlock, extractCsharpLoops } from "./csharpStateAndLoops.ts";

export interface CsharpFileExtractionInput {
  rel: string;
  text: string;
  unitName: string;
  rawLayer: string;
  canonicalLayer: CanonicalLayer;
  domainArea: string | null;
  knownDbSets: ReadonlyMap<string, string>;
  ast: AstIndexData;
  loops: LoopRecord[];
}

function joinRoutePath(prefix: string, suffix: string, allowAbsoluteOverride = true): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const cleanSuffix = suffix.replace(/^\/+|\/+$/g, "");
  if (suffix.startsWith("~/")) return `/${suffix.slice(2).replace(/^\/+/, "")}`;
  if (allowAbsoluteOverride && suffix.startsWith("/")) return suffix;
  if (!cleanPrefix && !cleanSuffix) return "/";
  if (!cleanPrefix) return `/${cleanSuffix}`;
  if (!cleanSuffix) return `/${cleanPrefix}`;
  return `/${cleanPrefix}/${cleanSuffix}`;
}

function extractControllerRoutes(input: CsharpFileExtractionInput): void {
  const { rel, text, unitName, ast } = input;
  const classMatches = Array.from(
    text.matchAll(
      /((?:\[(?:[^\]"]|"[^"]*")*\]\s*)*)\b(?:public|internal)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^)]*\))?(?:\s*:\s*([^{]+))?\s*\{/g,
    ),
  );

  let matchedAnyControllerClass = false;
  for (const cm of classMatches) {
    const attrBlock = cm[1] ?? "";
    const className = cm[2] ?? "";
    const bases = cm[3] ?? "";
    const isController =
      /Controller$/i.test(className) ||
      /\bController(?:Base)?\b/.test(bases) ||
      /\[ApiController\b/.test(attrBlock) ||
      /\[Route\s*\(/.test(attrBlock);
    if (!isController || cm.index === undefined) continue;
    matchedAnyControllerClass = true;

    const controllerToken = className.replace(/Controller$/i, "").toLowerCase();
    const classRouteRaw = attrBlock.match(/\[Route\s*\(\s*"([^"]*)"\s*\)\]/i)?.[1] ?? "";
    const classPrefix = classRouteRaw.replace(/\[controller\]/gi, controllerToken);
    const classHasAuthorize = /\[Authorize\b/.test(attrBlock);
    const classHasAnon = /\[AllowAnonymous\b/.test(attrBlock);

    const openIdx = cm.index + cm[0].length - 1;
    const body = extractBalancedBlock(text, openIdx);
    const bodyOffset = openIdx + 1;

    for (const hm of body.matchAll(
      /((?:\[(?:[^\]"]|"[^"]*")*\]\s*)+)(?:public|internal)\s+(?:(?:async|virtual|override|sealed|new|static)\s+)*[^\n;{=]+?\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/g,
    )) {
      const mAttrs = hm[1] ?? "";
      const actionName = hm[2] ?? "";
      if (!/\[Http(?:Get|Post|Put|Patch|Delete|Head|Options)\b/i.test(mAttrs)) continue;

      const methodAnon = /\[AllowAnonymous\b/.test(mAttrs);
      const methodAuth = /\[Authorize\b/.test(mAttrs);
      const authGuard = methodAnon
        ? "public"
        : methodAuth || (classHasAuthorize && !classHasAnon)
          ? "Authorize"
          : null;

      for (const verbMatch of mAttrs.matchAll(
        /\[Http(Get|Post|Put|Patch|Delete|Head|Options)\s*(?:\(\s*(?:Template\s*=\s*)?"([^"]*)"[^)]*\))?\]/gi,
      )) {
        const verb = (verbMatch[1] ?? "GET").toUpperCase();
        const rawTemplate = (verbMatch[2] ?? "").replace(/\[action\]/gi, actionName.toLowerCase());
        const fullPath = joinRoutePath(classPrefix, rawTemplate);
        const absIdx = bodyOffset + (hm.index ?? 0) + (verbMatch.index ?? 0);
        ast.httpEndpoints.push({
          unit: unitName,
          method: verb,
          path: fullPath,
          authGuard,
          source: "ast",
          handlerFile: rel,
          line: lineOf(text, absIdx),
          operationId: actionName || null,
        });
      }
    }
  }

  if (!matchedAnyControllerClass) {
    const fileAuth = /\[Authorize\b/.test(text) && !/\[AllowAnonymous\b/.test(text);
    for (const rm of text.matchAll(/\[Http(Get|Post|Put|Patch|Delete|Head|Options)\s*(?:\(\s*"([^"]*)"\s*\))?\]/gi)) {
      ast.httpEndpoints.push({
        unit: unitName,
        method: (rm[1] ?? "GET").toUpperCase(),
        path: rm[2] ? (rm[2].startsWith("/") ? rm[2] : `/${rm[2]}`) : "/",
        authGuard: fileAuth ? "Authorize" : null,
        source: "ast",
        handlerFile: rel,
        line: lineOf(text, rm.index ?? 0),
        operationId: null,
      });
    }
  }
}

function extractMinimalAndOtherRoutes(input: CsharpFileExtractionInput): void {
  const { rel, text, unitName, ast } = input;
  const groupPrefixes = new Map<string, { prefix: string; auth: string | null }>();
  for (const gm of text.matchAll(
    /(?:var|RouteGroupBuilder)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.MapGroup\s*\(\s*"([^"]+)"\s*\)([^;]*);/g,
  )) {
    const varName = gm[1];
    const parentName = gm[2] ?? "";
    const seg = gm[3] ?? "";
    const chain = gm[4] ?? "";
    if (!varName) continue;
    const parent = groupPrefixes.get(parentName);
    const fullPrefix = joinRoutePath(parent?.prefix ?? "", seg, false);
    const auth = /\.AllowAnonymous\b/.test(chain)
      ? "public"
      : /\.RequireAuthorization\b/.test(chain)
        ? "RequireAuthorization"
        : parent?.auth ?? null;
    groupPrefixes.set(varName, { prefix: fullPrefix, auth });
  }

  for (const rm of text.matchAll(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/g,
  )) {
    const targetVar = rm[1] ?? "";
    const verb = (rm[2] ?? "GET").toUpperCase();
    const rawPath = rm[3] ?? "/";
    const openParenIdx = rm.index !== undefined ? text.indexOf("(", rm.index) : -1;
    let tail = "";
    if (openParenIdx >= 0) {
      let depth = 0;
      let closeIdx = openParenIdx;
      for (let i = openParenIdx; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }
      const semiIdx = text.indexOf(";", closeIdx);
      tail = text.slice(closeIdx + 1, semiIdx >= 0 ? Math.min(semiIdx, closeIdx + 240) : closeIdx + 160);
    }
    const group = groupPrefixes.get(targetVar);
    const fullPath = group ? joinRoutePath(group.prefix, rawPath, false) : rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const authGuard = /\.AllowAnonymous\b/.test(tail)
      ? "public"
      : /\.RequireAuthorization\b/.test(tail)
        ? "RequireAuthorization"
        : group?.auth ?? null;
    ast.httpEndpoints.push({
      unit: unitName,
      method: verb,
      path: fullPath,
      authGuard,
      source: "ast",
      handlerFile: rel,
      line: lineOf(text, rm.index ?? 0),
      operationId: null,
    });
  }

  for (const hm of text.matchAll(/\.MapHub\s*<\s*([A-Za-z0-9_.]+)\s*>\s*\(\s*"([^"]+)"\s*\)/g)) {
    const hubName = hm[1] ?? null;
    const hubPath = hm[2] ?? "/";
    ast.httpEndpoints.push({
      unit: unitName,
      method: "WS",
      path: hubPath.startsWith("/") ? hubPath : `/${hubPath}`,
      authGuard: /\.RequireAuthorization\b/.test(text) ? "RequireAuthorization" : null,
      source: "ast",
      handlerFile: rel,
      line: lineOf(text, hm.index ?? 0),
      operationId: hubName,
    });
  }

  if (/\bEndpoint\s*</.test(text)) {
    const isAnon = /\bAllowAnonymous\s*\(\s*\)/.test(text);
    const hasAuth = /\b(?:Roles|Policies|Permissions|Claims)\s*\(/.test(text);
    for (const fm of text.matchAll(/\b(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"\s*\)/g)) {
      const verb = (fm[1] ?? "GET").toUpperCase();
      const rawPath = fm[2] ?? "/";
      ast.httpEndpoints.push({
        unit: unitName,
        method: verb,
        path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
        authGuard: isAnon ? "public" : hasAuth ? "Authorize" : null,
        source: "ast",
        handlerFile: rel,
        line: lineOf(text, fm.index ?? 0),
        operationId: null,
      });
    }
  }

  for (const am of text.matchAll(/\[HttpTrigger\s*\(([^)]+)\)\]/g)) {
    const args = am[1] ?? "";
    const routeMatch = args.match(/Route\s*=\s*"([^"]+)"/i);
    const verbs = Array.from(args.matchAll(/"(get|post|put|patch|delete)"/gi)).map((v) => (v[1] ?? "GET").toUpperCase());
    const authLevel = args.match(/AuthorizationLevel\.([A-Za-z]+)/)?.[1] ?? null;
    const routePath = routeMatch?.[1] ? joinRoutePath("api", routeMatch[1]) : "/api/function";
    for (const verb of verbs.length > 0 ? verbs : ["POST"]) {
      ast.httpEndpoints.push({
        unit: unitName,
        method: verb,
        path: routePath,
        authGuard: authLevel === "Anonymous" ? "public" : authLevel,
        source: "ast",
        handlerFile: rel,
        line: lineOf(text, am.index ?? 0),
        operationId: null,
      });
    }
  }
}

function extractDatastoreArtifacts(input: CsharpFileExtractionInput): void {
  const { rel, text, unitName, rawLayer, canonicalLayer, domainArea, knownDbSets, ast } = input;
  const seenDeclared = new Set<string>();
  const addDeclared = (datastore: string, entity: string): void => {
    const key = `${datastore}:${entity.toLowerCase()}`;
    if (seenDeclared.has(key)) return;
    seenDeclared.add(key);
    ast.declaredEntities.push({
      datastore,
      entity,
      declaredAt: rel,
      authorizedShared: false,
    });
  };

  for (const m of text.matchAll(/DbSet\s*<\s*([A-Za-z0-9_]+)\s*>\s+([A-Za-z0-9_]+)/g)) {
    const entityName = m[2] ?? m[1];
    if (!entityName) continue;
    addDeclared("efcore", entityName);
    ast.entityAccesses.push({
      datastore: "efcore",
      entity: entityName,
      file: rel,
      unit: unitName,
      layer: rawLayer,
      canonicalLayer,
      domainArea,
      op: "DBSET",
      line: lineOf(text, m.index ?? 0),
      confidence: "observed",
    });
  }

  for (const m of text.matchAll(/IEntityTypeConfiguration\s*<\s*([A-Za-z0-9_]+)\s*>/g)) {
    const entityType = m[1];
    if (!entityType) continue;
    const toTable = text.match(/\.ToTable\s*\(\s*"([A-Za-z0-9_]+)"/)?.[1];
    addDeclared("efcore", toTable ?? entityType);
  }

  for (const m of text.matchAll(/migrationBuilder\.CreateTable\s*\(\s*(?:name:\s*)?"([A-Za-z0-9_]+)"/g)) {
    if (m[1]) addDeclared("efcore", m[1]);
  }

  for (const m of text.matchAll(
    /migrationBuilder\.AddForeignKey\s*\([\s\S]{0,240}?table:\s*"([A-Za-z0-9_]+)"[\s\S]{0,160}?column:\s*"([A-Za-z0-9_]+)"[\s\S]{0,160}?principalTable:\s*"([A-Za-z0-9_]+)"(?:[\s\S]{0,120}?principalColumn:\s*"([A-Za-z0-9_]+)")?/g,
  )) {
    if (m[1] && m[2] && m[3]) {
      ast.dbForeignKeys.push({
        datastore: "efcore",
        fromTable: m[1],
        fromColumn: m[2],
        toTable: m[3],
        toColumn: m[4] ?? "Id",
        onDelete: null,
        declaredAt: rel,
        line: lineOf(text, m.index ?? 0),
      });
    }
  }

  for (const m of text.matchAll(
    /\.Set\s*<\s*([A-Za-z0-9_]+)\s*>\s*\(\s*\)\s*\.\s*(Find|First|Single|Where|Any|Count|ToList|Add|Update|Remove|ExecuteUpdate|ExecuteDelete|AsNoTracking)\w*\s*\(/g,
  )) {
    const entity = m[1];
    const method = m[2] ?? "QUERY";
    if (!entity) continue;
    const isWrite = /^(?:Add|Update|Remove|ExecuteUpdate|ExecuteDelete)/.test(method);
    ast.entityAccesses.push({
      datastore: "efcore",
      entity,
      file: rel,
      unit: unitName,
      layer: rawLayer,
      canonicalLayer,
      domainArea,
      op: isWrite ? "WRITE" : "READ",
      line: lineOf(text, m.index ?? 0),
      confidence: "observed",
    });
  }

  if (knownDbSets.size > 0) {
    for (const m of text.matchAll(
      /\b(?:_?(?:db|dbContext|context|ctx|unitOfWork|uow)|this)\.([A-Z][A-Za-z0-9_]*)\s*\.\s*(Find|First|Single|Where|Any|Count|ToList|Add|AddRange|Update|UpdateRange|Remove|RemoveRange|ExecuteUpdate|ExecuteDelete|AsNoTracking|Include|OrderBy|Select)\w*\s*\(/gi,
    )) {
      const prop = m[1];
      const method = m[2] ?? "QUERY";
      if (!prop) continue;
      const resolved = knownDbSets.get(prop.toLowerCase());
      if (!resolved) continue;
      const isWrite = /^(?:Add|Update|Remove|ExecuteUpdate|ExecuteDelete)/i.test(method);
      ast.entityAccesses.push({
        datastore: "efcore",
        entity: resolved,
        file: rel,
        unit: unitName,
        layer: rawLayer,
        canonicalLayer,
        domainArea,
        op: isWrite ? "WRITE" : "READ",
        line: lineOf(text, m.index ?? 0),
        confidence: "observed",
      });
    }
  }

  for (const m of text.matchAll(
    /\.(?:Query|QueryAsync|QueryFirst|QueryFirstAsync|QueryFirstOrDefault|QueryFirstOrDefaultAsync|QuerySingle|QuerySingleAsync|QuerySingleOrDefaultAsync|Execute|ExecuteAsync|ExecuteScalar|ExecuteScalarAsync|FromSqlRaw|FromSqlInterpolated)\s*(?:<[^>]+>)?\s*\(\s*(?:\$@|@\$|@|\$)?"([^"]{8,600})"/g,
  )) {
    const sql = m[1] ?? "";
    const ln = lineOf(text, m.index ?? 0);
    for (const tm of sql.matchAll(/\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:\[?[A-Za-z0-9_]+\]?\.)?\[?"?([A-Za-z_][A-Za-z0-9_]{1,48})"?\]?/gi)) {
      const kw = (tm[1] ?? "").toUpperCase();
      const tbl = tm[2];
      if (!tbl || /^(?:SELECT|SET|VALUES|WHERE|DUAL|LATERAL|UNNEST)$/i.test(tbl)) continue;
      const isWrite = kw === "INTO" || kw === "UPDATE" || kw.startsWith("DELETE");
      addDeclared("sql", tbl);
      ast.entityAccesses.push({
        datastore: "sql",
        entity: tbl,
        file: rel,
        unit: unitName,
        layer: rawLayer,
        canonicalLayer,
        domainArea,
        op: isWrite ? "WRITE" : "READ",
        line: ln,
        confidence: "observed",
      });
    }
  }
}

function extractConfigAndExternalHosts(input: CsharpFileExtractionInput): void {
  const { rel, text, unitName, rawLayer, canonicalLayer, ast } = input;
  const seenEnv = new Set<string>();
  const pushEnv = (envName: string, idx: number): void => {
    const key = `${envName}@${lineOf(text, idx)}`;
    if (seenEnv.has(key)) return;
    seenEnv.add(key);
    ast.envBindings.push({
      envName,
      sourceKind: "code_read",
      unit: unitName,
      file: rel,
      line: lineOf(text, idx),
      isSecret: isSecretEnvName(envName),
    });
  };

  for (const em of text.matchAll(
    /(?:GetEnvironmentVariable\s*\(\s*"([A-Za-z][A-Za-z0-9_:-]{2,})"\s*\)|(?:Configuration|_?config|_?configuration)\s*\[\s*"([A-Za-z0-9_:-]+)"\s*\]|\.(?:GetValue\s*<[^>]+>|GetSection|GetRequiredSection)\s*\(\s*"([A-Za-z0-9_:-]+)"\s*\)|\.GetConnectionString\s*\(\s*"([A-Za-z0-9_:-]+)"\s*\))/gi,
  )) {
    const idx = em.index ?? 0;
    if (em[4]) {
      pushEnv(`ConnectionStrings:${em[4]}`, idx);
    } else {
      const envName = em[1] ?? em[2] ?? em[3];
      if (envName) pushEnv(envName, idx);
    }
  }

  const seenHosts = new Set<string>();
  for (const um of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?(?:\/[^"'\s]*)?/g)) {
    const host = (um[1] ?? "").toLowerCase();
    if (!host || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|schemas\.|www\.w3\.org|example\.com|json-schema\.org)/.test(host)) {
      continue;
    }
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    ast.externalHosts.push({
      file: rel,
      unit: unitName,
      layer: rawLayer,
      canonicalLayer,
      host,
      serviceLabel: host,
      category: "http_api",
      line: lineOf(text, um.index ?? 0),
    });
  }
}

export function extractCsharpFileArtifacts(input: CsharpFileExtractionInput): void {
  extractControllerRoutes(input);
  extractMinimalAndOtherRoutes(input);
  extractDatastoreArtifacts(input);
  extractConfigAndExternalHosts(input);
  extractCsharpLoops(input.rel, input.text, input.unitName, input.loops);
}
