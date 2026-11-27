import fs from "node:fs";
import path from "node:path";
import { Effect, Layer, ManagedRuntime, PubSub, Ref, Result } from "effect";
import { StudioServerError } from "@repospec/plugin";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const WATCH_IGNORE = new Set([".git", "node_modules", "out", "dist", "build", ".next", "target", ".venv"]);

function validateLoopbackUrlEffect(raw: string): Effect.Effect<URL, StudioServerError> {
  return Effect.try({
    try: () => new URL(raw),
    catch: () => new StudioServerError({ message: "Invalid upstream URL", status: 400 }),
  }).pipe(
    Effect.flatMap((parsed) => {
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return Effect.fail(
          new StudioServerError({
            message: "Only http:// or https:// local AI endpoints are supported.",
            status: 400,
          }),
        );
      }
      if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
        return Effect.fail(
          new StudioServerError({
            message: "Local AI proxy only forwards to loopback hosts (127.0.0.1, localhost, ::1).",
            status: 400,
          }),
        );
      }
      return Effect.succeed(parsed);
    }),
  );
}

function shouldIgnoreWatchPath(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, "/").split("/");
  return parts.some((p) => WATCH_IGNORE.has(p) || p.startsWith(".repospec"));
}

function handleStudioRequestEffect(params: {
  req: Request;
  htmlPath: string;
  defaultUpstream: URL;
  reloadHub: PubSub.PubSub<string>;
  sseClients: Set<ReadableStreamDefaultController<Uint8Array>>;
  watchActive: boolean;
  enc: TextEncoder;
}): Effect.Effect<Response> {
  const { req, htmlPath, defaultUpstream, sseClients, watchActive, enc } = params;
  return Effect.gen(function* () {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/repospec.html")) {
      const html = fs.readFileSync(htmlPath, "utf8");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/live") {
      if (!watchActive) {
        return new Response("Watch mode inactive", { status: 204 });
      }
      let ctrlRef: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ctrlRef = controller;
          sseClients.add(controller);
          controller.enqueue(enc.encode("event: connected\ndata: ok\n\n"));
        },
        cancel() {
          if (ctrlRef) sseClients.delete(ctrlRef);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/ai/tags") {
      const target = new URL("/api/tags", defaultUpstream);
      return yield* Effect.tryPromise({
        try: async () => {
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
        },
        catch: () => new StudioServerError({ message: "Failed to fetch Ollama tags", status: 502 }),
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(Response.json({ models: [] }, { status: 502, headers: { "Cache-Control": "no-store" } })),
        ),
      );
    }

    if (req.method === "POST" && url.pathname === "/api/ai/explain") {
      const parsedBody = yield* Effect.tryPromise({
        try: () => req.json() as Promise<{ model?: string; url?: string; system?: string; prompt?: string }>,
        catch: () => new StudioServerError({ message: "Invalid JSON body", status: 400 }),
      }).pipe(Effect.result);

      if (Result.isFailure(parsedBody)) {
        return Response.json(
          { error: parsedBody.failure.message },
          { status: parsedBody.failure.status ?? 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      const body = parsedBody.success;
      let upstreamBase = defaultUpstream;
      if (typeof body.url === "string" && body.url.trim()) {
        const validated = yield* validateLoopbackUrlEffect(body.url.trim()).pipe(Effect.result);
        if (Result.isFailure(validated)) {
          return Response.json(
            { error: validated.failure.message },
            { status: validated.failure.status ?? 400, headers: { "Cache-Control": "no-store" } },
          );
        }
        upstreamBase = validated.success;
      }

      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "qwen3.5:9b";
      const system = typeof body.system === "string" ? body.system.slice(0, 1200) : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6400) : "";
      const chatUrl = new URL("/api/chat", upstreamBase);
      const t0 = performance.now();

      return yield* Effect.tryPromise({
        try: async () => {
          const up = await fetch(chatUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(45_000),
            body: JSON.stringify({
              model,
              stream: false,
              think: false,
              options: { num_predict: 220, temperature: 0.15 },
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
        },
        catch: (err) =>
          new StudioServerError({
            message: err instanceof Error ? err.message : "Failed to reach local Ollama",
            status: 502,
          }),
      }).pipe(
        Effect.catch((err) =>
          Effect.succeed(
            Response.json({ error: err.message }, { status: err.status ?? 502, headers: { "Cache-Control": "no-store" } }),
          ),
        ),
      );
    }

    return new Response("Not Found", { status: 404 });
  });
}

export interface StudioServerOptions {
  targetPath: string;
  port?: number;
  ollamaUrl?: string;
  watchDir?: string;
  onRebuild?: () => Promise<void>;
}

export function startStudioServer(opts: StudioServerOptions): {
  url: string;
  htmlPath: string;
  watching: boolean;
  stop: () => void;
} {
  const resolved = path.resolve(opts.targetPath);
  const htmlPath =
    fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? path.join(resolved, "repospec.html") : resolved;
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`RepoSpec HTML file not found: ${htmlPath}`);
  }

  const runtime = ManagedRuntime.make(Layer.empty);
  const defaultUpstream = runtime.runSync(validateLoopbackUrlEffect(opts.ollamaUrl ?? "http://127.0.0.1:11434"));
  const reloadHub = runtime.runSync(PubSub.bounded<string>(64));
  const rebuildState = runtime.runSync(Ref.make({ rebuilding: false, queued: false }));
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const watchActive = Boolean(opts.watchDir && opts.onRebuild);
  const enc = new TextEncoder();

  const handler = (req: Request): Promise<Response> =>
    runtime.runPromise(
      handleStudioRequestEffect({
        req,
        htmlPath,
        defaultUpstream,
        reloadHub,
        sseClients,
        watchActive,
        enc,
      }),
    );

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
      boundPort = server.port ?? tryPort;
      break;
    } catch {
      continue;
    }
  }

  if (!server) {
    void runtime.dispose();
    throw new Error(`Could not bind studio server on ports ${basePort}..${basePort + 9}`);
  }

  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const broadcastReload = Effect.gen(function* () {
    const payload = `event: reload\ndata: ${Date.now()}\n\n`;
    yield* PubSub.publish(reloadHub, payload);
    const msg = enc.encode(payload);
    for (const c of Array.from(sseClients)) {
      try {
        c.enqueue(msg);
      } catch {
        sseClients.delete(c);
      }
    }
  });

  const triggerRebuildEffect: Effect.Effect<void> = Effect.gen(function* () {
    const rebuildFn = opts.onRebuild;
    if (!rebuildFn) return;
    const shouldStart = yield* Ref.modify(rebuildState, (st) =>
      st.rebuilding ? [false, { rebuilding: true, queued: true }] : [true, { rebuilding: true, queued: false }],
    );
    if (!shouldStart) return;
    yield* Effect.tryPromise({
      try: () => rebuildFn(),
      catch: (err) => (err instanceof Error ? err.message : String(err)),
    }).pipe(
      Effect.andThen(broadcastReload),
      Effect.catch((msg) =>
        Effect.sync(() => {
          process.stderr.write(`watch rebuild error: ${msg}\n`);
        }),
      ),
    );
    const runAgain = yield* Ref.modify(rebuildState, (st) =>
      st.queued ? [true, { rebuilding: false, queued: false }] : [false, { rebuilding: false, queued: false }],
    );
    if (runAgain) {
      yield* triggerRebuildEffect;
    }
  });

  if (opts.watchDir && opts.onRebuild) {
    const absWatch = path.resolve(opts.watchDir);
    watcher = fs.watch(absWatch, { recursive: true }, (_event, filename) => {
      if (typeof filename === "string" && shouldIgnoreWatchPath(filename)) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void runtime.runPromise(triggerRebuildEffect);
      }, 450);
    });
  }

  const active = server;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    htmlPath,
    watching: watchActive,
    stop: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      for (const c of Array.from(sseClients)) {
        try {
          c.close();
        } catch {
          sseClients.delete(c);
        }
      }
      sseClients.clear();
      active.stop(true);
      void runtime.dispose();
    },
  };
}
