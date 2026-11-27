import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const DIST_DIR = path.join(ROOT, "dist");

const ENTRY_SPECS: ReadonlyArray<{ readonly src: string; readonly out: string }> = [
  { src: "src/cli.ts", out: "cli" },
  { src: "packages/core/src/index.ts", out: "core/index" },
  { src: "packages/core/src/facts.ts", out: "core/facts" },
  { src: "packages/core/src/eject.ts", out: "core/eject" },
  { src: "packages/core/src/effect.ts", out: "core/effect" },
  { src: "packages/plugin/src/index.ts", out: "plugin/index" },
  { src: "packages/plugin/src/effect/index.ts", out: "plugin/effect" },
  { src: "packages/cli/src/index.ts", out: "cli/index" },
  { src: "packages/report/src/index.ts", out: "report/index" },
  { src: "packages/show-me/src/index.ts", out: "show-me/index" },
  { src: "packages/show-me/src/svg.ts", out: "show-me/svg" },
  { src: "packages/ci/src/index.ts", out: "ci/index" },
  { src: "packages/flows/src/index.ts", out: "flows/index" },
  { src: "packages/flows/src/svg.ts", out: "flows/svg" },
  { src: "packages/flows/src/languages.ts", out: "flows/languages" },
  { src: "packages/perf/src/index.ts", out: "perf/index" },
  { src: "packages/perf/src/algorithms.ts", out: "perf/algorithms" },
  { src: "packages/perf/src/dataStructures.ts", out: "perf/data-structures" },
];

const EXTERNAL_DEPS = [
  "@dagrejs/dagre",
  "@effect/platform-bun",
  "@effect/sql-sqlite-bun",
  "@resvg/resvg-js",
  "effect",
  "js-yaml",
  "typescript",
];

function copyPerfRules(): void {
  const srcDir = path.join(ROOT, "packages/perf/rules");
  const dstDir = path.join(DIST_DIR, "perf-rules");
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith(".sql")) continue;
    fs.copyFileSync(path.join(srcDir, name), path.join(dstDir, name));
  }
}

async function runBuild(): Promise<void> {
  if (!fs.existsSync(path.join(ROOT, "package.json"))) {
    throw new Error("tools/build.ts must be executed inside the RepoSpec repository");
  }
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const stagingDir = path.join(DIST_DIR, ".entry-stage");
  fs.mkdirSync(stagingDir, { recursive: true });
  const stageEntries: string[] = [];

  try {
    for (const spec of ENTRY_SPECS) {
      const stageFile = path.join(stagingDir, `${spec.out}.ts`);
      fs.mkdirSync(path.dirname(stageFile), { recursive: true });
      const targetAbs = path.join(ROOT, spec.src);
      const rel = path.relative(path.dirname(stageFile), targetAbs).replaceAll("\\", "/");
      const importSpec = rel.startsWith(".") ? rel : `./${rel}`;
      fs.writeFileSync(stageFile, `export * from "${importSpec}";\n`);
      stageEntries.push(stageFile);
    }

    const result = await Bun.build({
      entrypoints: stageEntries,
      outdir: DIST_DIR,
      root: stagingDir,
      target: "bun",
      format: "esm",
      splitting: true,
      external: EXTERNAL_DEPS,
      naming: {
        entry: "[dir]/[name].mjs",
        chunk: "chunks/[name]-[hash].mjs",
      },
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  copyPerfRules();
  console.log(`Built ${ENTRY_SPECS.length} RepoSpec entrypoints into dist/`);
}

await runBuild();
