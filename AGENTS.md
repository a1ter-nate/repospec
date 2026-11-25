# AGENTS.md

1. Run `bun run check` before pushing (enforces `tsc --noEmit`, all Bun tests including `R2` tables/PBT and `R3` stateful MBT, `oxlint`, `no-comments`, `state-machines`, and `vstack scan --ratchet .verification/ratchet.json --fail-on-cheats`).
2. `tests/fixtures/`, `rules/`, and `skills/repospec/` are locked oracles; keep them passing without weakening assertions or deleting cases.
3. Keep `src/` and `tests/` free of prose comments (only tool directives, `WARNING:`, and `SAFETY:`).
4. Keep `src/`, `rules/`, and `tests/` free of private repository names, local user paths, and hardcoded vendor lists; register external SDK patterns only in `config/default-vendors.json`.
5. Keep `repospec.json` pure commit-time static facts (byte-identical SHA-256 across runs; zero wall-clock timestamps or random IDs).
6. Keep `skills/repospec/SKILL.md`, `skills/repospec/agents/openai.yaml`, and all relative markdown links valid (enforced by `tests/skill-packaging.test.ts`).
7. Follow `skill-craft` discipline when editing `skills/` or `AGENTS.md`: sharp context pointers, checkable completion criteria, positive steering, and zero duplicated rules.
