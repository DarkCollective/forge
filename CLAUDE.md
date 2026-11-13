# Working on Forge with Claude Code

## Development policy: orchestrate, don't implement

For any development work in this repo (features, fixes, phases, work packages):

- Act as the orchestrator only. Do not write or edit implementation code, tests, infra or docs
  yourself.
- Break the work into work packages (see docs/PLAN.md §7–8) and delegate each one to inexpensive
  sub-agents. Choose the model and number per task: Haiku for well-specified or repetitive work,
  Sonnet for spec-critical work. Run independent packages in parallel, each in its own git
  worktree on a `wp/<id>` branch, with explicit file ownership so agents never edit the same files.
- Give each agent a self-contained brief: what to read, what it owns, the "done when" checks, and
  the rules below.
- When an agent reports back, verify its work yourself: read the diff, check it stayed within its
  files, merge into main, then re-run
  `npm run lint && npm run typecheck && npm test && npm run build`, plus `npm run e2e` and
  `npm run size`.
- Send fixes back to an agent rather than making them yourself.
- At the end, verify that everything still works: the full CI above,
  `npm run gate2:browser -w @forge/worker`, and a check of the built app served with the
  production headers (`node apps/web/scripts/serve-prod.mjs`).
- Your own direct work is limited to research for briefs, reviewing, merging, running checks, and
  actions the owner must approve (pushes, `terraform apply`, AWS changes).

## Rules for everyone (orchestrator and sub-agents)

- Commits and PRs carry no AI/tool attribution trailers (no Co-Authored-By).
- Do not push, run `terraform apply`, or change AWS or GitHub settings without the owner's
  go-ahead.
- Every new source file starts with the Apache-2.0 licence header
  ("Copyright 2026 Darkcollective, LLC").
- `packages/*` hold frozen Phase 1–2 contracts. Change them only to fix a bug, without changing
  exports or types.
- The web app runs under a strict CSP: see docs/UI.md §4.
- FL source (`.fth`, `.fl`) follows the FL style guide, `docs/FL-STYLE.md` in the forge-plugin
  repository (checked out next to this one: `../forge-plugin/docs/FL-STYLE.md`). The IntelliJ
  plugin's formatter applies it and a test keeps the two in agreement; new and edited FL code
  should already be in that style. Prefer `cond`/`case` to nested `if` chains in new code.
