import fs from "node:fs";
import path from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function validateLoopbackUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// or https:// local AI endpoints are supported.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Local AI proxy only forwards to loopback hosts (127.0.0.1, localhost, ::1).");
  }
  return parsed;
}

function createStudioFetchHandler(htmlPath: string, defaultUpstream: URL): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/repospec.html")) {
      const html = fs.readFileSync(htmlPath, "utf8");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/ai/tags") {
      const target = new URL("/api/tags", defaultUpstream);
      try {
        const up = await fetch(target.toString(), {
          method: "GET",
          signal: AbortSignal.timeout(5_000),
        });
        if (!up.ok) {
          await up.body?.cancel();
          return Response.json({ models: [] }, { status: up.status, headers: { "Cache-Control": "no-store" } });
        }
        const data = await up.json();
        return Response.json(data, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ models: [] }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/ai/explain") {
      let body: { model?: string; url?: string; system?: string; prompt?: string };
      try {
        body = (await req.json()) as { model?: string; url?: string; system?: string; prompt?: string };
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      let upstreamBase = defaultUpstream;
      if (typeof body.url === "string" && body.url.trim()) {
        try {
          upstreamBase = validateLoopbackUrl(body.url.trim());
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Invalid upstream URL" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "qwen3.5:9b";
      const system = typeof body.system === "string" ? body.system.slice(0, 1200) : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 4800) : "";
      const chatUrl = new URL("/api/chat", upstreamBase);
      const t0 = performance.now();
      try {
        const up = await fetch(chatUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            options: { num_predict: 180, temperature: 0.15 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!up.ok) {
          const errText = await up.text().catch(() => "");
          return Response.json(
            { error: `Ollama HTTP ${up.status}: ${errText.slice(0, 200)}` },
            { status: 502, headers: { "Cache-Control": "no-store" } },
          );
        }
        const data = (await up.json()) as { message?: { content?: string }; model?: string };
        return Response.json(
          {
            text: data?.message?.content ?? "",
            model: data?.model ?? model,
            durationMs: Math.round(performance.now() - t0),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Failed to reach local Ollama" },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

export interface StudioServerOptions {
  targetPath: string;
  port?: number;
  ollamaUrl?: string;
}

export function startStudioServer(opts: StudioServerOptions): { url: string; htmlPath: string; stop: () => void } {
  const resolved = path.resolve(opts.targetPath);
  const htmlPath = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, "repospec.html")
    : resolved;
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`RepoSpec HTML file not found: ${htmlPath}`);
  }

  const defaultUpstream = validateLoopbackUrl(opts.ollamaUrl ?? "http://127.0.0.1:11434");
  const handler = createStudioFetchHandler(htmlPath, defaultUpstream);
  const basePort = opts.port ?? 4173;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let boundPort = basePort;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tryPort = basePort + attempt;
    try {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: tryPort,
        fetch: handler,
      });
      boundPort = tryPort;
      break;
    } catch {
      continue;
    }
  }

  if (!server) {
    throw new Error(`Could not bind studio server on ports ${basePort}..${basePort + 9}`);
  }
  const active = server;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    htmlPath,
    stop: () => {
      active.stop(true);
    },
  };
}
