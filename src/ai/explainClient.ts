export function renderExplainClientScript(): string {
  return `
  const AI_CFG_KEY = "repospec:ai-cfg:v1";
  const AI_CACHE_PREFIX = "repospec:ai:v1:";
  const aiPendingKeys = new Set();
  const aiErrorsByKey = new Map();
  const aiDetectedModels = [];
  let aiConfigOpen = false;
  let aiLastAutoKey = "";

  function loadAiConfig() {
    const def = {
      provider: "ollama",
      url: "http://127.0.0.1:11434",
      model: "qwen3.5:9b",
      apiKey: "",
      autoExplain: false,
    };
    try {
      const raw = localStorage.getItem(AI_CFG_KEY);
      if (!raw) return def;
      const parsed = JSON.parse(raw);
      return {
        provider: parsed.provider === "openai" ? "openai" : "ollama",
        url: typeof parsed.url === "string" && parsed.url.trim() ? parsed.url.trim() : def.url,
        model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : def.model,
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        autoExplain: Boolean(parsed.autoExplain),
      };
    } catch {
      return def;
    }
  }

  function saveAiConfig(next) {
    try { localStorage.setItem(AI_CFG_KEY, JSON.stringify(next)); } catch {}
  }

  function hashExplainText(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function readCachedExplain(key) {
    try {
      const raw = localStorage.getItem(AI_CACHE_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeCachedExplain(key, val) {
    try { localStorage.setItem(AI_CACHE_PREFIX + key, JSON.stringify(val)); } catch {}
  }

  function splitIdentWords(name) {
    const clean = String(name || "").replace(/^[_#]+/, "").split(".").pop() || "";
    const spaced = clean
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .toLowerCase();
    return spaced || clean;
  }

  function extractLeadingDoc(allLines, startLine) {
    const out = [];
    let i = startLine - 2;
    let scanned = 0;
    while (i >= 0 && scanned < 12) {
      const t = (allLines[i] || "").trim();
      if (!t) {
        if (out.length > 0) break;
        i -= 1;
        scanned += 1;
        continue;
      }
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/") || t.startsWith("#")) {
        const cleaned = t
          .replace(/^\\/\\*+\\s?/, "")
          .replace(/\\*+\\/$/, "")
          .replace(/^\\*\\s?/, "")
          .replace(/^\\/\\/\\/?\\s?/, "")
          .replace(/^#+\\s?/, "")
          .trim();
        if (cleaned && !cleaned.startsWith("@")) out.unshift(cleaned);
        i -= 1;
        scanned += 1;
        continue;
      }
      break;
    }
    const joined = out.join(" ").replace(/\\s+/g, " ").trim();
    return joined.length >= 16 ? joined.slice(0, 240) : "";
  }

  function buildDeterministicExplain(fileRec, sym, allLines, callers, callees, exts) {
    const tags = [];
    if (!sym) {
      const pubs = (fileRec.m || []).filter((m) => m[1] === "pub");
      const privs = (fileRec.m || []).filter((m) => m[1] === "priv");
      const caps = (fileRec.c || []).filter((c) => c !== "PURE");
      for (const c of caps.slice(0, 4)) tags.push(c.replace(/_/g, " "));
      if (tags.length === 0) tags.push("PURE LOGIC");
      const fname = fileRec.p.split("/").pop() || fileRec.p;
      const pubNames = pubs.slice(0, 4).map((p) => formatSymDisplayName(p)).join(", ");
      const extNames = (fileRec.x || []).slice(0, 3).join(", ");
      const parts = [
        fname + " exposes " + pubs.length + " public symbol" + (pubs.length === 1 ? "" : "s") +
          (pubNames ? " (" + pubNames + (pubs.length > 4 ? ", …" : "") + ")" : "") +
          (privs.length > 0 ? " backed by " + privs.length + " private helper" + (privs.length === 1 ? "" : "s") : "") + ".",
      ];
      if (extNames) parts.push("Integrates with " + extNames + ".");
      else if (fileRec.t && fileRec.t.length > 0) parts.push("Touches data entities: " + fileRec.t.slice(0, 3).join(", ") + ".");
      const watch = fileRec.v && fileRec.v.length > 0
        ? "Reads environment config (" + fileRec.v.slice(0, 3).join(", ") + ")."
        : "";
      return { does: parts.join(" "), watch, tags };
    }

    const startIdx = Math.max(0, sym[3] - 1);
    const endIdx = Math.min(allLines.length - 1, sym[4] - 1);
    const slice = allLines.slice(startIdx, endIdx + 1).join("\\n");
    const sigLine = (allLines[startIdx] || "").trim() + " " + (allLines[startIdx + 1] || "").trim();
    const doc = extractLeadingDoc(allLines, sym[3]);

    const isAsync = /\\basync\\b|\\bawait\\b/.test(slice);
    const hasHttp = /\\b(axios|fetch|http|https|got|ky)\\b|https?:\\/\\//.test(slice);
    const hasDb = /\\b(firestore|collection|query|select|insert|update|delete|prisma|drizzle|sql|dao)\\b/i.test(slice);
    const hasVal = /\\b(validate|schema|zod|joi|parse|assert|sanitize)\\b/i.test(slice);
    const hasEnv = /process\\.env|import\\.meta\\.env|os\\.environ|std::env/.test(slice);
    const hasErr = /\\b(try\\s*\\{|catch\\s*\\(|throw\\s+new|captureException|captureProviderFailure)\\b/.test(slice);

    if (isAsync) tags.push("Async");
    if (hasVal) tags.push("Validation");
    if (hasHttp) tags.push("HTTP / API");
    if (hasDb) tags.push("Database");
    if (hasEnv) tags.push("Env Config");
    if (hasErr) tags.push("Error Guard");
    if (tags.length === 0) tags.push("Pure Logic");

    const paramMatch = sigLine.match(/\\(([^)]{0,120})\\)/);
    const rawParams = paramMatch && paramMatch[1] ? paramMatch[1].split(",").map((p) => p.trim().split(/[:=?]/)[0].trim()).filter(Boolean) : [];
    const retMatch = sigLine.match(/\\)\\s*:\\s*([A-Za-z0-9_<>, |\\[\\]?]+?)\\s*\\{/);
    const retType = retMatch && retMatch[1] ? retMatch[1].trim() : "";

    const visWord = sym[1] === "pub" ? "Public" : "Private";
    const kindWord = sym[2] === "method" ? "method" : sym[2] === "class" ? "class" : sym[2] === "const" ? "export" : "function";
    const phrase = splitIdentWords(sym[0]);
    const steps = [];
    if (hasVal) steps.push("validates inputs");
    if (callees.length > 0) steps.push("delegates to " + callees.slice(0, 2).map((c) => c.name).join(", "));
    if (exts.length > 0) steps.push("calls " + exts.slice(0, 2).map((e) => e.name).join(", "));
    else if (hasHttp) steps.push("performs an external HTTP request");
    if (hasDb) steps.push("reads or writes persisted data");

    const does = doc
      ? doc
      : visWord + " " + (isAsync ? "async " : "") + kindWord + " to " + phrase +
        (rawParams.length > 0 ? " using (" + rawParams.slice(0, 4).join(", ") + (rawParams.length > 4 ? ", …" : "") + ")" : "") +
        (steps.length > 0 ? "; " + steps.join(" and ") : "") +
        (retType ? " and returns " + retType : "") + ".";

    const watchParts = [];
    if (hasEnv) watchParts.push("depends on runtime environment variables");
    if (hasHttp) watchParts.push("makes external network calls");
    if (hasErr && /return\\s+null\\b/.test(slice)) watchParts.push("can return null on failure or missing prerequisites");
    else if (hasErr) watchParts.push("throws or catches errors along its execution path");
    if (callers.length > 0) watchParts.push("used by " + callers.length + " caller" + (callers.length === 1 ? "" : "s") + " in this file");
    const watch = watchParts.length > 0
      ? watchParts[0].charAt(0).toUpperCase() + watchParts[0].slice(1) + (watchParts.length > 1 ? "; " + watchParts.slice(1).join("; ") : "") + "."
      : "";

    return { does, watch, tags: tags.slice(0, 5) };
  }

  function parseAiResponseText(raw) {
    const clean = String(raw || "").trim().replace(/<think>[\\s\\S]*?<\\/think>/gi, "").replace(/\\*\\*/g, "").trim();
    const lines = clean.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
    const doesParts = [];
    let watch = "";
    for (const ln of lines) {
      if (/^(?:WATCH(?:\\s+OUT)?|CAVEAT|NOTE)\\s*:/i.test(ln)) {
        watch = ln.replace(/^(?:WATCH(?:\\s+OUT)?|CAVEAT|NOTE)\\s*:\\s*/i, "").trim();
      } else {
        const cleaned = ln.replace(/^(?:DOES|DO|WHAT\\s+IT\\s+DOES|SUMMARY)\\s*:\\s*/i, "").trim();
        if (cleaned) doesParts.push(cleaned);
      }
    }
    let does = doesParts.join(" ").trim();
    if (!watch && /\\bWATCH(?:\\s+OUT)?\\s*:/i.test(does)) {
      const idx = does.search(/\\bWATCH(?:\\s+OUT)?\\s*:/i);
      watch = does.slice(idx).replace(/^WATCH(?:\\s+OUT)?\\s*:\\s*/i, "").trim();
      does = does.slice(0, idx).trim();
    }
    return { does: does || clean, watch };
  }

  async function detectOllamaModels() {
    const cfg = loadAiConfig();
    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    const urls = [];
    if (isHttp && cfg.provider === "ollama") urls.push("/api/ai/tags");
    urls.push(cfg.url.replace(/\\/+$/, "") + (cfg.provider === "openai" ? "/models" : "/api/tags"));
    for (const u of urls) {
      try {
        const res = await fetch(u, { method: "GET" });
        if (!res.ok) continue;
        const data = await res.json();
        const names = Array.isArray(data.models)
          ? data.models.map((m) => m.name || m.model).filter(Boolean)
          : Array.isArray(data.data)
            ? data.data.map((m) => m.id).filter(Boolean)
            : [];
        if (names.length > 0) {
          aiDetectedModels.length = 0;
          for (const n of names.slice(0, 12)) aiDetectedModels.push(n);
          if (!names.includes(cfg.model)) {
            cfg.model = names[0];
            saveAiConfig(cfg);
          }
          render();
          return;
        }
      } catch {}
    }
  }

  async function requestLocalAiExplain(cacheKey, payload, forceRefresh) {
    if (aiPendingKeys.has(cacheKey)) return;
    if (!forceRefresh && readCachedExplain(cacheKey)) return;
    const cfg = loadAiConfig();
    aiPendingKeys.add(cacheKey);
    aiErrorsByKey.delete(cacheKey);
    render();

    const sysPrompt =
      "You explain code clearly for both technical engineers and non-technical product readers. " +
      "Reply with EXACTLY two short lines, plain text, no markdown bullets or headings:\\n" +
      "DOES: <1-2 crisp sentences explaining what this code accomplishes in plain English>\\n" +
      "WATCH: <1 short sentence highlighting side effects, external services, edge cases, or return/error behavior>";

    const userPrompt =
      "File: " + payload.filePath + "\\n" +
      "Symbol: " + payload.symbolLabel + "\\n" +
      (payload.callContext ? "Call context: " + payload.callContext + "\\n" : "") +
      "Code:\\n" + payload.snippet.slice(0, 3200);

    try {
      const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
      let text = "";
      let usedModel = cfg.model;

      if (isHttp && cfg.provider === "ollama") {
        const proxyRes = await fetch("/api/ai/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model, url: cfg.url, system: sysPrompt, prompt: userPrompt }),
        });
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          text = data.text || "";
          usedModel = data.model || cfg.model;
        } else if (proxyRes.status !== 404) {
          const errTxt = await proxyRes.text().catch(() => "");
          throw new Error("Local AI proxy error (" + proxyRes.status + "): " + errTxt.slice(0, 140));
        }
      }

      if (!text) {
        const base = cfg.url.replace(/\\/+$/, "");
        if (cfg.provider === "openai") {
          const endpoint = base.endsWith("/chat/completions") ? base : base + "/chat/completions";
          const headers = { "Content-Type": "application/json" };
          if (cfg.apiKey) headers["Authorization"] = "Bearer " + cfg.apiKey;
          const res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: cfg.model,
              temperature: 0.15,
              max_tokens: 180,
              messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });
          if (!res.ok) throw new Error("Endpoint returned HTTP " + res.status);
          const data = await res.json();
          text = data?.choices?.[0]?.message?.content || "";
        } else {
          const res = await fetch(base + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: cfg.model,
              stream: false,
              think: false,
              options: { num_predict: 180, temperature: 0.15 },
              messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });
          if (!res.ok) throw new Error("Ollama returned HTTP " + res.status);
          const data = await res.json();
          text = data?.message?.content || "";
        }
      }

      const parsed = parseAiResponseText(text);
      if (!parsed.does) throw new Error("Empty response from model " + usedModel);
      writeCachedExplain(cacheKey, {
        does: parsed.does,
        watch: parsed.watch,
        model: usedModel,
        ts: Date.now(),
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const isFileProto = window.location.protocol === "file:";
      const hint = isFileProto && /fetch|network|cors|load/i.test(msg)
        ? "Browser blocked file:// -> localhost CORS. Open with: repospec serve <html-path>  (or start Ollama with OLLAMA_ORIGINS=\\"*\\" ollama serve)."
        : msg;
      aiErrorsByKey.set(cacheKey, hint);
    } finally {
      aiPendingKeys.delete(cacheKey);
      render();
    }
  }

  const aiPayloadsByKey = new Map();

  function renderWhatThisDoesBox(fileIdx, fileRec, sym, callers, callees, exts) {
    const raw = FILE_SOURCES && typeof FILE_SOURCES[fileIdx] === "string" ? FILE_SOURCES[fileIdx] : "";
    const allLines = raw ? raw.split("\\n") : [];
    const startLine = sym ? sym[3] : 1;
    const endLine = sym ? sym[4] : Math.min(allLines.length || 1, 140);
    const snippet = allLines.length > 0 ? allLines.slice(Math.max(0, startLine - 1), endLine).join("\\n") : "";
    const symLabel = sym ? formatSymDisplayName(sym) : (fileRec.p.split("/").pop() || fileRec.p);
    const cacheKey = fileRec.p + "::" + symLabel + "::" + hashExplainText(snippet.slice(0, 1800));

    const callParts = [];
    if (callers.length > 0) callParts.push("Called by: " + callers.slice(0, 4).map((c) => c.name).join(", "));
    if (callees.length > 0) callParts.push("Calls internal: " + callees.slice(0, 5).map((c) => c.name).join(", "));
    if (exts.length > 0) callParts.push("Calls external: " + exts.slice(0, 5).map((e) => e.name).join(", "));
    const payload = {
      filePath: fileRec.p,
      symbolLabel: symLabel + " (L" + startLine + "–" + endLine + ")",
      callContext: callParts.join(" | "),
      snippet,
    };
    aiPayloadsByKey.set(cacheKey, payload);

    const cfg = loadAiConfig();
    const cached = readCachedExplain(cacheKey);
    const loading = aiPendingKeys.has(cacheKey);
    const errMsg = aiErrorsByKey.get(cacheKey) || "";
    const det = buildDeterministicExplain(fileRec, sym, allLines, callers, callees, exts);

    if (cfg.autoExplain && !cached && !loading && !errMsg && snippet && aiLastAutoKey !== cacheKey) {
      aiLastAutoKey = cacheKey;
      setTimeout(() => { requestLocalAiExplain(cacheKey, payload, false); }, 0);
    }

    const activeDoes = cached ? cached.does : det.does;
    const activeWatch = cached ? cached.watch : det.watch;
    const sourceBadge = cached
      ? '<span class="badge b-purple">✦ AI · ' + esc(cached.model) + "</span>"
      : '<span class="badge b-na">Instant</span>';

    const modelOptions = aiDetectedModels.length > 0
      ? '<div class="pill-row" style="margin-top:4px">' + aiDetectedModels.map((m) =>
          '<button class="tray-chip" data-ai-pick-model="' + esc(m) + '">' + esc(m) + "</button>"
        ).join("") + "</div>"
      : "";

    const cfgPanel = aiConfigOpen
      ? '<div class="explain-cfg">' +
        '<div class="explain-cfg-row">' +
        '<label class="explain-lbl">Provider</label>' +
        '<span class="seg-group">' +
        '<button class="seg-btn' + (cfg.provider === "ollama" ? " active" : "") + '" data-ai-provider="ollama">Ollama (Local)</button>' +
        '<button class="seg-btn' + (cfg.provider === "openai" ? " active" : "") + '" data-ai-provider="openai">OpenAI-Compat</button>' +
        "</span></div>" +
        '<div class="explain-cfg-row"><label class="explain-lbl">Endpoint</label><input class="explain-inp" id="ai-url-inp" value="' + esc(cfg.url) + '" placeholder="http://127.0.0.1:11434" /></div>' +
        '<div class="explain-cfg-row"><label class="explain-lbl">Model</label><div style="display:flex;gap:6px;flex:1"><input class="explain-inp" id="ai-model-inp" value="' + esc(cfg.model) + '" placeholder="qwen3.5:9b" /><button class="tbtn" data-ai-detect="1" title="Detect installed local models">Detect</button></div></div>' +
        modelOptions +
        (cfg.provider === "openai"
          ? '<div class="explain-cfg-row"><label class="explain-lbl">API Key</label><input class="explain-inp" id="ai-key-inp" type="password" value="' + esc(cfg.apiKey) + '" placeholder="Optional (stored only in browser)" /></div>'
          : "") +
        '<div class="explain-cfg-foot">' +
        '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);cursor:pointer"><input type="checkbox" id="ai-auto-chk"' + (cfg.autoExplain ? " checked" : "") + ' /> Auto-explain symbols on click</label>' +
        '<button class="tbtn" data-ai-save="1">Save</button>' +
        "</div></div>"
      : "";

    return (
      '<div class="explain-box">' +
      '<div class="explain-head">' +
      '<div class="explain-head-left"><span class="sec-title" style="color:var(--text-2)">What This Does</span>' + sourceBadge + "</div>" +
      '<div class="explain-head-right">' +
      '<button class="tbtn explain-ai-btn" data-ai-ask="' + esc(cacheKey) + '"' + (loading ? " disabled" : "") + ">" +
      (loading ? "Thinking…" : cached ? "↻ Refresh AI" : "✦ Ask Local AI") +
      "</button>" +
      '<button class="tbtn" data-ai-cfg-toggle="1" title="Configure local or cheap AI model">⚙</button>' +
      "</div></div>" +
      '<div class="explain-body">' + esc(activeDoes) + "</div>" +
      (activeWatch ? '<div class="explain-watch"><strong>Watch out:</strong> ' + esc(activeWatch) + "</div>" : "") +
      (det.tags.length > 0
        ? '<div class="pill-row">' + det.tags.map((t) => '<span class="explain-tag">' + esc(t) + "</span>").join("") + "</div>"
        : "") +
      (errMsg ? '<div class="explain-err">' + esc(errMsg) + "</div>" : "") +
      cfgPanel +
      "</div>"
    );
  }

  function handleExplainClick(target) {
    const askBtn = target.closest("[data-ai-ask]");
    if (askBtn) {
      const key = askBtn.getAttribute("data-ai-ask") || "";
      const payload = aiPayloadsByKey.get(key);
      if (payload) {
        const hadCache = Boolean(readCachedExplain(key));
        requestLocalAiExplain(key, payload, hadCache);
      }
      return true;
    }
    if (target.closest("[data-ai-cfg-toggle]")) {
      aiConfigOpen = !aiConfigOpen;
      if (aiConfigOpen && aiDetectedModels.length === 0) detectOllamaModels();
      render();
      return true;
    }
    const provBtn = target.closest("[data-ai-provider]");
    if (provBtn) {
      const cfg = loadAiConfig();
      const nextProv = provBtn.getAttribute("data-ai-provider") === "openai" ? "openai" : "ollama";
      cfg.provider = nextProv;
      if (nextProv === "openai" && cfg.url === "http://127.0.0.1:11434") cfg.url = "http://127.0.0.1:1234/v1";
      if (nextProv === "ollama" && cfg.url === "http://127.0.0.1:1234/v1") cfg.url = "http://127.0.0.1:11434";
      saveAiConfig(cfg);
      render();
      return true;
    }
    if (target.closest("[data-ai-detect]")) {
      detectOllamaModels();
      return true;
    }
    const pickBtn = target.closest("[data-ai-pick-model]");
    if (pickBtn) {
      const cfg = loadAiConfig();
      cfg.model = pickBtn.getAttribute("data-ai-pick-model") || cfg.model;
      saveAiConfig(cfg);
      render();
      return true;
    }
    if (target.closest("[data-ai-save]")) {
      const cfg = loadAiConfig();
      const uEl = document.getElementById("ai-url-inp");
      const mEl = document.getElementById("ai-model-inp");
      const kEl = document.getElementById("ai-key-inp");
      const aEl = document.getElementById("ai-auto-chk");
      if (uEl && uEl.value.trim()) cfg.url = uEl.value.trim();
      if (mEl && mEl.value.trim()) cfg.model = mEl.value.trim();
      if (kEl) cfg.apiKey = kEl.value.trim();
      if (aEl) cfg.autoExplain = Boolean(aEl.checked);
      saveAiConfig(cfg);
      aiConfigOpen = false;
      render();
      return true;
    }
    return false;
  }
`;
}
