import zlib from "node:zlib";

export type FileSymbolTuple = [
  name: string,
  vis: "pub" | "priv",
  kind: "fn" | "method" | "class" | "const",
  startLine: number,
  endLine: number,
  owner?: string,
];

export interface FileCallGraphData {
  m: FileSymbolTuple[];
  k: Array<[number, number, number]>;
  o: Array<[number, string, number]>;
}

const LANG_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "return", "throw", "catch", "try",
  "finally", "new", "typeof", "instanceof", "void", "delete", "await", "yield", "import",
  "export", "from", "super", "this", "self", "Self", "class", "function", "const", "let",
  "var", "async", "def", "lambda", "with", "as", "in", "not", "and", "or", "is", "pass",
  "elif", "except", "raise", "assert", "match", "fn", "pub", "impl", "struct", "enum",
  "trait", "where", "loop", "break", "continue", "using", "namespace", "public", "private",
  "protected", "internal", "static", "readonly", "override", "virtual", "abstract", "sealed",
  "sizeof", "nameof", "default", "checked", "unchecked", "lock", "fixed", "Some", "Ok", "Err",
  "None", "Vec", "Box", "Arc", "Rc", "String", "Number", "Boolean", "Array", "Object", "Map",
  "Set", "Promise", "Error", "Date", "RegExp", "Math", "JSON", "console", "print", "len",
  "range", "str", "int", "float", "bool", "list", "dict", "set", "tuple", "isinstance", "type",
  "require", "describe", "it", "test", "expect", "constructor",
]);

function stripCommentsAndStringsPreserveLines(src: string, isPython: boolean): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i] ?? "";
    const nxt = src[i + 1] ?? "";
    if (isPython && ch === "#") {
      while (i < n && src[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }
    if (!isPython && ch === "/" && nxt === "/") {
      while (i < n && src[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }
    if (!isPython && ch === "/" && nxt === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < n) {
        out.push(" ", " ");
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || (!isPython && ch === "`")) {
      const quote = ch;
      out.push(" ");
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          out.push(src[i + 1] === "\n" ? "\n" : " ", " ");
          i += 2;
          continue;
        }
        out.push(src[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < n) {
        out.push(" ");
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

function findBraceEndLine(lines: string[], startIdx: number): number {
  let depth = 0;
  let seenOpen = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    const ln = lines[i] ?? "";
    for (let j = 0; j < ln.length; j += 1) {
      const c = ln[j];
      if (c === "{") {
        depth += 1;
        seenOpen = true;
      } else if (c === "}") {
        depth -= 1;
        if (seenOpen && depth <= 0) return i + 1;
      }
    }
    if (!seenOpen && i > startIdx + 3 && ln.includes(";")) return i + 1;
  }
  return Math.min(lines.length, startIdx + 1);
}

function findPythonEndLine(lines: string[], startIdx: number, baseIndent: number): number {
  let lastNonEmpty = startIdx + 1;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const ln = lines[i] ?? "";
    const trimmed = ln.trim();
    if (!trimmed) continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent <= baseIndent) return lastNonEmpty;
    lastNonEmpty = i + 1;
  }
  return lastNonEmpty;
}

function extractTsJsSymbols(cleanLines: string[]): FileSymbolTuple[] {
  const syms: FileSymbolTuple[] = [];
  let i = 0;
  while (i < cleanLines.length) {
    const ln = cleanLines[i] ?? "";
    const trimmed = ln.trim();
    const indent = ln.length - ln.trimStart().length;
    if (!trimmed || indent > 2) {
      i += 1;
      continue;
    }

    const clsMatch = trimmed.match(/^(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (clsMatch?.[2]) {
      const clsVis: "pub" | "priv" = clsMatch[1] ? "pub" : "priv";
      const clsName = clsMatch[2];
      const clsEnd = findBraceEndLine(cleanLines, i);
      let memberCount = 0;
      let j = i + 1;
      while (j < clsEnd - 1) {
        const mln = cleanLines[j] ?? "";
        const mTrim = mln.trim();
        const mIndent = mln.length - mln.trimStart().length;
        if (mTrim && mIndent >= 2 && mIndent <= 6) {
          const mm = mTrim.match(
            /^(?:(public|private|protected)\s+)?(?:static\s+)?(?:readonly\s+)?(?:async\s+)?(?:(?:get|set)\s+)?(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/,
          );
          const mName = mm?.[2];
          if (mName && !LANG_KEYWORDS.has(mName)) {
            const access = mm[1];
            const isPriv =
              clsVis === "priv" ||
              access === "private" ||
              access === "protected" ||
              mName.startsWith("#") ||
              mName.startsWith("_");
            const mEnd = findBraceEndLine(cleanLines, j);
            syms.push([mName, isPriv ? "priv" : "pub", "method", j + 1, mEnd, clsName]);
            memberCount += 1;
            j = Math.max(j + 1, mEnd);
            continue;
          }
        }
        j += 1;
      }
      if (memberCount === 0) {
        syms.push([clsName, clsVis, "class", i + 1, clsEnd]);
      }
      i = Math.max(i + 1, clsEnd);
      continue;
    }

    const fnMatch = trimmed.match(/^(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/);
    if (fnMatch?.[2]) {
      const end = findBraceEndLine(cleanLines, i);
      syms.push([fnMatch[2], fnMatch[1] ? "pub" : "priv", "fn", i + 1, end]);
      i = Math.max(i + 1, end);
      continue;
    }

    const arrowMatch = trimmed.match(
      /^(export\s+)?(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=>/,
    );
    if (arrowMatch?.[2]) {
      const end = findBraceEndLine(cleanLines, i);
      syms.push([arrowMatch[2], arrowMatch[1] ? "pub" : "priv", "fn", i + 1, end]);
      i = Math.max(i + 1, end);
      continue;
    }

    const expConstObj = trimmed.match(/^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*\{/);
    if (expConstObj?.[1]) {
      const end = findBraceEndLine(cleanLines, i);
      syms.push([expConstObj[1], "pub", "const", i + 1, end]);
      i = Math.max(i + 1, end);
      continue;
    }

    i += 1;
  }
  return syms;
}

function extractPythonSymbols(cleanLines: string[]): FileSymbolTuple[] {
  const syms: FileSymbolTuple[] = [];
  let currentClass: { name: string; indent: number; endLine: number } | null = null;
  for (let i = 0; i < cleanLines.length; i += 1) {
    const ln = cleanLines[i] ?? "";
    const trimmed = ln.trim();
    if (!trimmed) continue;
    const indent = ln.length - ln.trimStart().length;
    if (currentClass && i + 1 > currentClass.endLine) currentClass = null;

    const cm = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (cm?.[1] && indent === 0) {
      const endLine = findPythonEndLine(cleanLines, i, indent);
      currentClass = { name: cm[1], indent, endLine };
      continue;
    }

    const fm = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (fm?.[1]) {
      const name = fm[1];
      const endLine = findPythonEndLine(cleanLines, i, indent);
      const isPriv = name.startsWith("_") && name !== "__init__";
      if (currentClass && indent > currentClass.indent) {
        const ownerPriv = currentClass.name.startsWith("_");
        syms.push([name, ownerPriv || isPriv ? "priv" : "pub", "method", i + 1, endLine, currentClass.name]);
      } else if (indent === 0) {
        syms.push([name, isPriv ? "priv" : "pub", "fn", i + 1, endLine]);
      }
    }
  }
  return syms;
}

function extractRustSymbols(cleanLines: string[]): FileSymbolTuple[] {
  const syms: FileSymbolTuple[] = [];
  let currentImpl: { name: string; endLine: number } | null = null;
  for (let i = 0; i < cleanLines.length; i += 1) {
    const ln = cleanLines[i] ?? "";
    const trimmed = ln.trim();
    if (currentImpl && i + 1 > currentImpl.endLine) currentImpl = null;

    const im = trimmed.match(/^impl(?:<[^>]*>)?\s+(?:[A-Za-z0-9_:<>]+\s+for\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
    if (im?.[1]) {
      currentImpl = { name: im[1], endLine: findBraceEndLine(cleanLines, i) };
      continue;
    }

    const fm = trimmed.match(/^(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (fm?.[2]) {
      const endLine = findBraceEndLine(cleanLines, i);
      const vis: "pub" | "priv" = fm[1] ? "pub" : "priv";
      if (currentImpl) {
        syms.push([fm[2], vis, "method", i + 1, endLine, currentImpl.name]);
      } else {
        syms.push([fm[2], vis, "fn", i + 1, endLine]);
      }
    }
  }
  return syms;
}

function extractCsharpSymbols(cleanLines: string[]): FileSymbolTuple[] {
  const syms: FileSymbolTuple[] = [];
  let currentType: { name: string; vis: "pub" | "priv"; endLine: number } | null = null;
  for (let i = 0; i < cleanLines.length; i += 1) {
    const ln = cleanLines[i] ?? "";
    const trimmed = ln.trim();
    if (currentType && i + 1 > currentType.endLine) currentType = null;

    const tm = trimmed.match(/^(public|internal|private|protected)?\s*(?:sealed|abstract|static|partial|readonly)?\s*(?:class|record|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (tm?.[2]) {
      const vis: "pub" | "priv" = tm[1] === "private" || tm[1] === "protected" ? "priv" : "pub";
      currentType = { name: tm[2], vis, endLine: findBraceEndLine(cleanLines, i) };
      continue;
    }

    const mm = trimmed.match(
      /^(public|private|protected|internal)\s+(?:(?:static|async|virtual|override|sealed|new|partial)\s+)*[A-Za-z0-9_<>,?.[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/,
    );
    if (mm?.[1] && mm[2] && !LANG_KEYWORDS.has(mm[2])) {
      const endLine = findBraceEndLine(cleanLines, i);
      const isPriv = mm[1] === "private" || mm[1] === "protected" || currentType?.vis === "priv";
      syms.push([mm[2], isPriv ? "priv" : "pub", "method", i + 1, endLine, currentType?.name]);
    }
  }
  return syms;
}

function collectImportedIdentifiers(rawText: string, ext: string): Map<string, string> {
  const imported = new Map<string, string>();
  if (ext === ".py") {
    for (const m of rawText.matchAll(/^from\s+([\w.]+)\s+import\s+([^\n#]+)/gm)) {
      const mod = (m[1] ?? "").split(".").pop() ?? m[1] ?? "";
      for (const part of (m[2] ?? "").split(",")) {
        const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (alias && /^[A-Za-z_]\w*$/.test(alias)) imported.set(alias, `${mod}.${alias}`);
      }
    }
    return imported;
  }
  if (ext === ".rs") {
    for (const m of rawText.matchAll(/use\s+[\w:]+::(?:\{([^}]+)\}|([A-Za-z_]\w*))/g)) {
      const list = m[1] ? m[1].split(",") : m[2] ? [m[2]] : [];
      for (const item of list) {
        const name = item.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_]\w*$/.test(name)) imported.set(name, name);
      }
    }
    return imported;
  }
  for (const m of rawText.matchAll(/import\s+(?:type\s+)?([^;\n]+?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = m[1] ?? "";
    const modRaw = m[2] ?? "";
    if (clause.startsWith("type ")) continue;
    const modName = modRaw.split("/").pop()?.replace(/\.[a-z]+$/i, "") ?? modRaw;
    const named = clause.match(/\{([^}]+)\}/);
    if (named?.[1]) {
      for (const spec of named[1].split(",")) {
        const clean = spec.replace(/^type\s+/, "").trim();
        const alias = clean.split(/\s+as\s+/).pop()?.trim();
        if (alias && /^[A-Za-z_$]\w*$/.test(alias)) imported.set(alias, `${modName}.${alias}`);
      }
    }
    const defPart = clause.replace(/\{[^}]*\}/, "").replace(/\*+\s+as\s+/, "").replace(/,/g, "").trim();
    if (defPart && /^[A-Za-z_$]\w*$/.test(defPart)) {
      imported.set(defPart, modName);
    }
  }
  return imported;
}

export function extractFileCallGraph(filePath: string, rawText: string): FileCallGraphData {
  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  const isPython = ext === ".py";
  const cleanText = stripCommentsAndStringsPreserveLines(rawText, isPython);
  const cleanLines = cleanText.split("\n");

  let syms: FileSymbolTuple[] = [];
  if (isPython) syms = extractPythonSymbols(cleanLines);
  else if (ext === ".rs") syms = extractRustSymbols(cleanLines);
  else if (ext === ".cs") syms = extractCsharpSymbols(cleanLines);
  else syms = extractTsJsSymbols(cleanLines);

  if (syms.length > 60) {
    const pubs = syms.filter((s) => s[1] === "pub");
    const privs = syms.filter((s) => s[1] === "priv");
    syms = [...pubs.slice(0, 32), ...privs.slice(0, 60 - Math.min(32, pubs.length))];
  }

  const byOwnerName = new Map<string, number>();
  const firstByName = new Map<string, number>();
  const secondByName = new Map<string, number>();
  syms.forEach((s, idx) => {
    if (s[5]) byOwnerName.set(`${s[5]}::${s[0]}`, idx);
    if (!firstByName.has(s[0])) firstByName.set(s[0], idx);
    else if (!secondByName.has(s[0])) secondByName.set(s[0], idx);
  });

  const imported = collectImportedIdentifiers(rawText, ext);
  const intraCalls: Array<[number, number, number]> = [];
  const extCalls: Array<[number, string, number]> = [];

  for (let i = 0; i < syms.length; i += 1) {
    const sym = syms[i];
    if (!sym) continue;
    const owner = sym[5];
    const startIdx = Math.max(0, sym[3] - 1);
    const endIdx = Math.min(cleanLines.length - 1, sym[4] - 1);
    const seenIntra = new Set<number>();
    const seenExt = new Set<string>();

    for (let li = startIdx; li <= endIdx; li += 1) {
      const lineStr = cleanLines[li] ?? "";
      for (const m of lineStr.matchAll(/(?:(this|self|Self)(?:\.|::))?([A-Za-z_$#][A-Za-z0-9_$]*)(?:\.([A-Za-z_$][A-Za-z0-9_$]*))?\s*\(/g)) {
        if (li === startIdx && (m.index ?? 0) < 40 && (m[2] === sym[0] || m[3] === sym[0])) continue;
        const recv = m[1];
        const first = m[2] ?? "";
        const prop = m[3];
        const candidateName = prop && !recv ? prop : first;
        if (!candidateName || LANG_KEYWORDS.has(candidateName)) continue;

        if (firstByName.has(candidateName) && (!prop || Boolean(recv))) {
          const ownedTarget = owner ? byOwnerName.get(`${owner}::${candidateName}`) : undefined;
          const primaryTarget = firstByName.get(candidateName);
          const fallbackTarget = secondByName.get(candidateName);
          const best =
            ownedTarget !== undefined && ownedTarget !== i
              ? ownedTarget
              : primaryTarget !== undefined && primaryTarget !== i
                ? primaryTarget
                : fallbackTarget !== undefined && fallbackTarget !== i
                  ? fallbackTarget
                  : undefined;
          if (best !== undefined && !seenIntra.has(best)) {
            seenIntra.add(best);
            intraCalls.push([i, best, li + 1]);
          }
          continue;
        }

        if (seenExt.size < 6) {
          const impLabel = imported.get(first);
          if (impLabel) {
            const full = prop ? `${impLabel}.${prop}` : impLabel;
            if (!seenExt.has(full)) {
              seenExt.add(full);
              extCalls.push([i, full, li + 1]);
            }
          } else if (first === "fetch" || first === "axios") {
            const full = prop ? `${first}.${prop}` : first;
            if (!seenExt.has(full)) {
              seenExt.add(full);
              extCalls.push([i, full, li + 1]);
            }
          }
        }
      }
    }
  }

  return { m: syms, k: intraCalls, o: extCalls };
}

export function packSourceArchiveBase64(sources: string[]): string {
  const json = JSON.stringify(sources);
  return zlib.gzipSync(Buffer.from(json, "utf8"), { level: 6 }).toString("base64");
}
