import fs from "node:fs";
import path from "node:path";
import type { RepoContext } from "@repospec/plugin";

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hasWholeToken(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function readTextSafe(absPath: string): string {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

function collectAllPackageScripts(ctx: RepoContext): Map<string, string> {
  const scripts = new Map<string, string>();
  const pkgFiles = ctx.allFiles.filter((f) => f === "package.json" || f.endsWith("/package.json"));
  for (const rel of pkgFiles) {
    const txt = readTextSafe(path.join(ctx.rootDir, rel));
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt) as { name?: string; scripts?: Record<string, string> };
      for (const [k, v] of Object.entries(parsed.scripts ?? {})) {
        const existing = scripts.get(k);
        scripts.set(k, existing ? `${existing}\n${v}` : v);
        if (parsed.name) {
          scripts.set(`${parsed.name}::${k}`, v);
        }
      }
    } catch {
      continue;
    }
  }
  return scripts;
}

function expandShellScriptsOneHop(rootDir: string, text: string): string {
  let out = text;
  const seen = new Set<string>();
  for (const m of text.matchAll(/([a-zA-Z0-9_./-]+\.sh)\b/g)) {
    const scriptRel = (m[1] ?? "").replace(/^\.\//, "");
    if (!scriptRel || seen.has(scriptRel)) continue;
    seen.add(scriptRel);
    const body = readTextSafe(path.join(rootDir, scriptRel));
    if (body) out += `\n${body}`;
  }
  return out;
}

function expandPackageScriptsOneHop(rootDir: string, text: string, allScripts: Map<string, string>): string {
  let out = text;
  const expandedNames = new Set<string>();
  for (let pass = 0; pass < 2; pass += 1) {
    let added = false;
    for (const [name, cmd] of allScripts) {
      if (name.includes("::") || expandedNames.has(name)) continue;
      if (
        out.includes(`run ${name}`) ||
        out.includes(`bun ${name}`) ||
        out.includes(`pnpm ${name}`) ||
        out.includes(`yarn ${name}`) ||
        out.includes(`turbo run ${name}`)
      ) {
        out += `\n${cmd}`;
        expandedNames.add(name);
        added = true;
      }
    }
    if (!added) break;
  }
  return expandShellScriptsOneHop(rootDir, out);
}

function expandAzureTemplates(rootDir: string, wfFile: string, text: string): string {
  let out = text;
  const seen = new Set<string>();
  let frontier: Array<{ relDir: string; content: string }> = [
    { relDir: path.posix.dirname(wfFile), content: text },
  ];
  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    const nextFrontier: Array<{ relDir: string; content: string }> = [];
    for (const item of frontier) {
      for (const m of item.content.matchAll(/\btemplate:\s*["']?([^\s"'@#]+\.ya?ml)["']?/gi)) {
        const rawRef = (m[1] ?? "").replace(/^\.\//, "");
        if (!rawRef) continue;
        const candidates = [
          path.posix.normalize(item.relDir === "." ? rawRef : `${item.relDir}/${rawRef}`),
          path.posix.normalize(rawRef),
        ];
        for (const cand of candidates) {
          if (cand.startsWith("..") || seen.has(cand)) continue;
          const body = readTextSafe(path.join(rootDir, cand));
          if (body) {
            seen.add(cand);
            out += `\n${body}`;
            nextFrontier.push({ relDir: path.posix.dirname(cand), content: body });
            break;
          }
        }
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

function buildPrChecksExpansionMap(
  rootDir: string,
  allGateInfos: Array<{ name: string; scriptPath: string | null; commandHint: string; rung?: string }>,
  allScripts: Map<string, string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const vgText =
    readTextSafe(path.join(rootDir, "tools/verify-gates.ts")) ||
    readTextSafe(path.join(rootDir, "tools/verify-gates.mjs"));
  if (!vgText) return map;
  const prIdx = vgText.indexOf("export const PR_CHECKS");
  if (prIdx < 0) return map;
  const prSection = vgText.slice(prIdx);
  const blockRegex = /name:\s*["'](pr-[^"']+)["'][\s\S]*?command:\s*\[([\s\S]*?)\]/g;
  let m: RegExpExecArray | null = blockRegex.exec(prSection);
  while (m !== null) {
    const prName = m[1];
    const rawCmd = (m[2] ?? "").replace(/["',]/g, " ");
    if (prName) {
      const expandedCmd = expandPackageScriptsOneHop(rootDir, rawCmd, allScripts);
      const hits: string[] = [];
      for (const g of allGateInfos) {
        const hintToken = g.commandHint.trim();
        if (
          (g.scriptPath && expandedCmd.includes(g.scriptPath)) ||
          (hintToken && hintToken.length >= 4 && expandedCmd.includes(hintToken)) ||
          expandedCmd.includes(`--only ${g.name}`) ||
          expandedCmd.includes(`check-${g.name}`) ||
          expandedCmd.includes(`verify:${g.name}`)
        ) {
          hits.push(g.name);
        }
      }
      if (hits.length > 0) map.set(prName, hits);
    }
    m = blockRegex.exec(prSection);
  }
  return map;
}

function resolveInvokedGatesInWorkflow(
  rootDir: string,
  wfContent: string,
  allGateInfos: Array<{ name: string; scriptPath: string | null; commandHint: string; rung?: string }>,
  prCheckMap: Map<string, string[]>,
  allScripts: Map<string, string>,
  compositeActionTexts: Map<string, string>,
  wfFile = "",
): string[] {
  let expanded = wfFile ? expandAzureTemplates(rootDir, wfFile, wfContent) : wfContent;
  for (const [actionRel, actionText] of compositeActionTexts) {
    if (expanded.includes(actionRel)) {
      expanded += `\n${actionText}`;
    }
  }
  expanded = expandPackageScriptsOneHop(rootDir, expanded, allScripts);

  const matched = new Set<string>();
  const allNames = allGateInfos.map((g) => g.name);

  for (const line of expanded.split("\n")) {
    if (line.includes("verify-gates")) {
      const onlyMatch = line.match(/--only(?:=|\s+)([a-zA-Z0-9_,-]+)/);
      if (onlyMatch?.[1]) {
        for (const item of onlyMatch[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (allNames.includes(item)) matched.add(item);
          const prExpanded = prCheckMap.get(item);
          if (prExpanded) {
            for (const g of prExpanded) matched.add(g);
          }
        }
        continue;
      }
      const skipMatch = line.match(/--skip(?:=|\s+)([a-zA-Z0-9_,-]+)/);
      const skipped = new Set(
        skipMatch?.[1] ? skipMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
      );
      if (/verify-gates\.(?:mjs|ts)(?:\s|$|"|')/.test(line) || line.includes("verify:gates")) {
        for (const g of allNames) {
          if (!skipped.has(g)) matched.add(g);
        }
      }
    }

    const runRungMatch = line.match(/\brun-rung\s+([a-zA-Z0-9_,-]+)/i);
    if (runRungMatch?.[1]) {
      const arg = runRungMatch[1].trim().toLowerCase();
      if (arg === "all") {
        for (const g of allGateInfos) {
          if (g.name.startsWith("rung-") || g.rung) matched.add(g.name);
        }
      } else {
        const requested = new Set(arg.split(",").map((s) => s.trim().toUpperCase()));
        for (const g of allGateInfos) {
          if (g.rung && requested.has(g.rung.toUpperCase())) matched.add(g.name);
        }
      }
    }
  }

  for (const g of allGateInfos) {
    if (
      expanded.includes(`run ${g.name}`) ||
      expanded.includes(`bun ${g.name}`) ||
      expanded.includes(`pnpm ${g.name}`) ||
      expanded.includes(`yarn ${g.name}`)
    ) {
      matched.add(g.name);
      continue;
    }
    if (g.scriptPath && expanded.includes(g.scriptPath)) {
      matched.add(g.name);
      continue;
    }
    const hintToken = g.commandHint.trim();
    if (hintToken && hintToken.length >= 4) {
      if (expanded.includes(hintToken)) {
        matched.add(g.name);
        continue;
      }
      const parts = hintToken.split("&&").map((p) => p.trim()).filter((p) => p.length >= 6);
      if (parts.length >= 2 && parts.every((p) => expanded.includes(p))) {
        matched.add(g.name);
        continue;
      }
    }
    if (g.name === "clones" && (expanded.includes("clone:check") || expanded.includes("jscpd"))) {
      matched.add(g.name);
    }
    if (g.name === "knip" && (expanded.includes("knip:public") || /\bknip\b/.test(expanded))) {
      matched.add(g.name);
    }
    if (g.name === "check-migrations" && expanded.includes("check-migrations.py")) {
      matched.add(g.name);
    }
  }

  return Array.from(matched).sort();
}


export const CROSS_LINK_GATES = {
  normalizeToken,
  hasWholeToken,
  readTextSafe,
  collectAllPackageScripts,
  buildPrChecksExpansionMap,
  resolveInvokedGatesInWorkflow,
} as const;
