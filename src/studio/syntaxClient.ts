export function renderSyntaxClientScript(): string {
  return `
  const SYNTAX_KW = new Set([
    "import", "export", "from", "default", "as", "async", "await", "function", "return",
    "const", "let", "var", "class", "extends", "implements", "interface", "type", "enum",
    "new", "this", "super", "if", "else", "for", "while", "do", "switch", "case", "break",
    "continue", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of",
    "void", "readonly", "public", "private", "protected", "static", "abstract", "override",
    "def", "lambda", "with", "yield", "pass", "elif", "except", "raise", "assert", "and",
    "or", "not", "is", "fn", "pub", "impl", "struct", "trait", "where", "match", "use",
    "mod", "mut", "ref", "loop", "move", "unsafe", "using", "namespace", "internal",
    "sealed", "record", "virtual", "partial", "select", "where", "join", "on", "group",
    "order", "by", "limit", "create", "table", "from", "when", "then", "end",
  ]);
  const SYNTAX_LIT = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "None", "True", "False", "self", "Self"]);
  const SYNTAX_PRIM_TYPES = new Set([
    "string", "number", "boolean", "unknown", "never", "any", "object", "symbol", "bigint",
    "int", "float", "str", "bool", "dict", "list", "tuple", "set", "i8", "i16", "i32", "i64",
    "u8", "u16", "u32", "u64", "usize", "isize", "f32", "f64", "decimal", "Task", "ValueTask",
  ]);

  function langChipForPath(filePath) {
    const lo = String(filePath || "").toLowerCase();
    if (lo.endsWith(".tsx")) return "TSX";
    if (lo.endsWith(".ts") || lo.endsWith(".mts")) return "TS";
    if (lo.endsWith(".jsx")) return "JSX";
    if (lo.endsWith(".js") || lo.endsWith(".mjs") || lo.endsWith(".cjs")) return "JS";
    if (lo.endsWith(".py")) return "PY";
    if (lo.endsWith(".rs")) return "RUST";
    if (lo.endsWith(".cs")) return "C#";
    if (lo.endsWith(".sql")) return "SQL";
    if (lo.endsWith(".json")) return "JSON";
    if (lo.endsWith(".yml") || lo.endsWith(".yaml")) return "YAML";
    if (lo.endsWith(".sh") || lo.endsWith(".bash")) return "SH";
    return "CODE";
  }

  function highlightCodeLine(line, filePath) {
    const lo = String(filePath || "").toLowerCase();
    const hashComment = lo.endsWith(".py") || lo.endsWith(".sh") || lo.endsWith(".bash") || lo.endsWith(".yml") || lo.endsWith(".yaml");
    const sqlComment = lo.endsWith(".sql");
    const n = line.length;
    if (n === 0) return " ";
    let i = 0;
    let out = "";
    let prevNonWs = "";

    while (i < n) {
      const ch = line[i];
      const nxt = line[i + 1] || "";

      if ((hashComment && ch === "#") || (!hashComment && ch === "/" && nxt === "/") || (sqlComment && ch === "-" && nxt === "-")) {
        out += '<span class="tok-cm">' + esc(line.slice(i)) + "</span>";
        break;
      }
      if (!hashComment && ch === "/" && nxt === "*") {
        const end = line.indexOf("*/", i + 2);
        const stop = end >= 0 ? end + 2 : n;
        out += '<span class="tok-cm">' + esc(line.slice(i, stop)) + "</span>";
        i = stop;
        continue;
      }
      if (ch === '"' || ch === "'" || (!hashComment && ch === String.fromCharCode(96))) {
        const q = ch;
        let j = i + 1;
        while (j < n && line[j] !== q) {
          if (line[j] === "\\\\" && j + 1 < n) j += 2;
          else j += 1;
        }
        if (j < n) j += 1;
        out += '<span class="tok-st">' + esc(line.slice(i, j)) + "</span>";
        prevNonWs = q;
        i = j;
        continue;
      }
      if (ch === "@" && i + 1 < n && /[A-Za-z_]/.test(line[i + 1])) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_.]/.test(line[j])) j += 1;
        out += '<span class="tok-dec">' + esc(line.slice(i, j)) + "</span>";
        prevNonWs = "@";
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(line[i - 1]))) {
        let j = i + 1;
        while (j < n && /[0-9a-fA-FxXoObB_.]/.test(line[j])) j += 1;
        out += '<span class="tok-nu">' + esc(line.slice(i, j)) + "</span>";
        prevNonWs = "0";
        i = j;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
        const word = line.slice(i, j);
        let k = j;
        while (k < n && line[k] === " ") k += 1;
        const nextChar = line[k] || "";
        let cls = "";
        if (SYNTAX_KW.has(word)) cls = "tok-kw";
        else if (SYNTAX_LIT.has(word)) cls = "tok-nu";
        else if (SYNTAX_PRIM_TYPES.has(word)) cls = "tok-ty";
        else if (nextChar === "(") cls = "tok-fn";
        else if (prevNonWs === ".") cls = "tok-pr";
        else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) cls = word === word.toUpperCase() && word.length > 1 ? "tok-nu" : "tok-ty";
        else if (nextChar === ":" && prevNonWs !== "?") cls = "tok-pr";
        out += cls ? '<span class="' + cls + '">' + esc(word) + "</span>" : esc(word);
        prevNonWs = word;
        i = j;
        continue;
      }
      if ("=+-*/%<>!&|?:~^".includes(ch)) {
        let j = i + 1;
        while (j < n && "=+-*/%<>!&|?:~^".includes(line[j]) && j - i < 3) j += 1;
        const op = line.slice(i, j);
        out += '<span class="tok-op">' + esc(op) + "</span>";
        prevNonWs = op;
        i = j;
        continue;
      }
      if ("{}()[],;.".includes(ch)) {
        out += '<span class="tok-pu">' + esc(ch) + "</span>";
        prevNonWs = ch;
        i += 1;
        continue;
      }
      out += esc(ch);
      if (ch !== " " && ch !== "\\t") prevNonWs = ch;
      i += 1;
    }
    return out;
  }
`;
}
