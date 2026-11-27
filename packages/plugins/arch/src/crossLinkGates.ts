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
  for (const [name, cmd] of allScripts) {
    if (name.includes("::")) continue;
    if (
      out.includes(`run ${name}`) ||
      out.includes(`pnpm ${name}`) ||
      out.includes(`turbo run ${name}`)
    ) {
      out += `\n${cmd}`;
    }
  }
  return expandShellScriptsOneHop(rootDir, out);
}

function buildPrChecksExpansionMap(
  rootDir: string,
  allGateInfos: Array<{ name: string; scriptPath: string | null; commandHint: string }>,
  allScripts: Map<string, string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const vgText = readTextSafe(path.join(rootDir, "tools/verify-gates.mjs"));
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
  allGateInfos: Array<{ name: string; scriptPath: string | null; commandHint: string }>,
  prCheckMap: Map<string, string[]>,
  allScripts: Map<string, string>,
  compositeActionTexts: Map<string, string>,
): string[] {
  let expanded = wfContent;
  for (const [actionRel, actionText] of compositeActionTexts) {
    if (wfContent.includes(actionRel)) {
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
      if (/verify-gates\.mjs(?:\s|$|"|')/.test(line) || line.includes("verify:gates")) {
        for (const g of allNames) {
          if (!skipped.has(g)) matched.add(g);
        }
      }
    }
  }

  for (const g of allGateInfos) {
    if (g.scriptPath && expanded.includes(g.scriptPath)) {
      matched.add(g.name);
      continue;
    }
    const hintToken = g.commandHint.trim();
    if (hintToken && hintToken.length >= 4 && expanded.includes(hintToken)) {
      matched.add(g.name);
      continue;
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
