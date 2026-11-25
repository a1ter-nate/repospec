import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SKILL_DIR = path.join(REPO_ROOT, "skills/repospec");

function extractFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match?.[1]) {
    throw new Error("Missing YAML frontmatter block");
  }
  const parsed = yaml.load(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontmatter did not parse as a YAML mapping");
  }
  return parsed as Record<string, unknown>;
}

function collectMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const m of markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
      continue;
    }
    links.push(target.split("#")[0] ?? target);
  }
  return links;
}

describe("Skill & README packaging integrity (R2) [REQ-HYGIENE-01]", () => {
  test("skills/repospec/SKILL.md has strict YAML frontmatter synced with agents/openai.yaml", () => {
    const skillPath = path.join(SKILL_DIR, "SKILL.md");
    const openAiPath = path.join(SKILL_DIR, "agents/openai.yaml");
    const skillText = fs.readFileSync(skillPath, "utf8");
    const fm = extractFrontmatter(skillText);

    expect(fm.name).toBe("repospec");
    expect(typeof fm.description).toBe("string");
    expect(String(fm.description).length).toBeGreaterThan(40);
    expect(fm["disable-model-invocation"]).toBeUndefined();

    const companion = yaml.load(fs.readFileSync(openAiPath, "utf8")) as {
      interface?: { display_name?: string; short_description?: string };
      policy?: { allow_implicit_invocation?: boolean };
    };
    expect(companion.interface?.display_name).toBe("RepoSpec");
    expect(typeof companion.interface?.short_description).toBe("string");
    expect(companion.policy?.allow_implicit_invocation).toBeUndefined();
  });

  test("all relative markdown links in SKILL.md, references, and README.md resolve on disk", () => {
    const filesToCheck = [
      path.join(SKILL_DIR, "SKILL.md"),
      path.join(SKILL_DIR, "references/invariants-and-sql.md"),
      path.join(SKILL_DIR, "references/taxonomy-and-studio.md"),
      path.join(REPO_ROOT, "README.md"),
    ];

    for (const absFile of filesToCheck) {
      const content = fs.readFileSync(absFile, "utf8");
      const baseDir = path.dirname(absFile);
      for (const relTarget of collectMarkdownLinks(content)) {
        const resolved = path.resolve(baseDir, relTarget);
        expect(fs.existsSync(resolved)).toBe(true);
      }
    }
  });
});
