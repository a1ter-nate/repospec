# AGENTS.md

## Hard Verification Gates
1. Run `bun run check` before committing or pushing (`tsc --noEmit`, `bun test`, `oxlint` with `@interfere/landmines` + `anti-slop`, `lint:privacy`, `lint:ts-only`, `no-comments`, `state-machines`, `laws --verify`, `formal-sync`, `bench`, `perf:check` empirical Big-O, `vstack scan . --strict`, and `vstack doctor . --fail`).
2. Enforce **100% TypeScript** across `src/` and `tests/` (zero `.js`/`.mjs`/`.cjs` files, zero untyped browser JS embedded inside TS template strings).
3. Enforce a **500-line hard file cap** (`max-lines <= 500`), **`<= 6` runtime exports per module**, and **`<= 15` entries per directory** (`wide-directory`). Split cohesive responsibilities into deep modules rather than padding or ratcheting debt.
4. `tests/fixtures/`, `rules/`, and `skills/repospec/` are locked oracles; keep them passing without weakening assertions or deleting cases.
5. Keep `src/` and `tests/` free of prose comments (only tool directives, `WARNING:`, and `SAFETY:`).
6. Keep `src/`, `rules/`, and `tests/` free of private repository names, local user paths, and hardcoded vendor lists (`bun run lint:privacy`); register external SDK patterns only in `config/default-vendors.json`.
7. Keep `repospec.json` pure commit-time static facts (byte-identical SHA-256 across runs; zero wall-clock timestamps or random IDs).
8. Keep `skills/repospec/SKILL.md`, `skills/repospec/agents/openai.yaml`, and all relative markdown links valid (`tests/skill-packaging.test.ts`).

## No-AI-Slop Engineering Workflow
9. **Shape-first checkpoint:** Before any edit touching `> 3` files or adding a new CLI/schema surface, state a 10-line shape proposal (exact CLI/data contract, what is explicitly out of scope, and what gets deleted or replaced) before writing code.
10. **One cohesive feature per commit:** Never bundle unrelated tiers or features into a mega-commit; run `repospec diff` / inspect the diff shape before pushing non-trivial work.
11. **Subtract as you build:** Schedule and run regular subtraction passes to remove unused UI controls, collapse duplicate logic, and burn down complexity rather than only appending.
12. **Repeat-to-rule promotion:** When a mistake happens twice, promote it into an automated check in `package.json`, `.oxlintrc.json`, or `lefthook.yml` the same day instead of relying on prose reminders.
13. **Honest provenance:** Mark tool- or AI-generated PR outlines/summaries clearly and remind reviewers to verify **Special Things to Note** before posting.
14. Follow `skill-craft` discipline when editing `skills/` or `AGENTS.md`: sharp context pointers, checkable completion criteria, positive steering, and zero duplicated rules.
