# Lean task workflow (optimized SDD)

Operating procedure for running tasks with the superpowers plugin **without** the
ceremony that made the audit-log run take 8 hours. Point every future plan at this file.
The goal: keep the quality superpowers gives, cut the redundant steps, and make token +
wall-clock cost proportional to the task.

## What was burning the budget (audit-log run: ~18 tasks, ~8 h)

1. **Too many micro-tasks** — per-task ceremony (brief + implement + reviews + report + commit) paid 18×.
2. **Context re-ingested per subagent** — every brief/impl/review/report subagent re-read the full 16KB `CLAUDE.md` + spec + source from scratch. That file alone got read ~90+ times.
3. **2–3 review rounds on every task**, including mechanical ones that never needed them.
4. **900-line reports** — output tokens generated that no human reads.
5. **SonarQube fix loops** — each bounce re-ran implement + review.

## The lean loop (new default per task)

Cut the per-task steps to the minimum that still protects correctness:

1. **Intent check (30 s, human):** the task restates what it will build, in behaviors, in one short paragraph. You approve or correct. Catches logical drift before any code.
2. **Implement + test in one pass:** one subagent writes the code **and** its tests, against the task's acceptance criteria. Tests are written from the criteria, not copied from the plan.
3. **Gates:** `format:check → lint → typecheck → test → build` (+ `db:*` for schema tasks). Green before review. These are objective; they replace most review chatter.
4. **Review — by risk, not by default (see matrix):** 0 rounds for mechanical, 1 for normal, 2 for high-stakes. A review round reads the diff + acceptance criteria only — not the whole module.
5. **Terse report (≤ 12 lines):** what changed, gate status, any deviation from the criteria. No essays.
6. **Commit** (one per task).

Everything not on this list is optional and off by default.

## Cut list — redundant steps to drop

- **Drop** the second/third review round on mechanical + UI tasks. Keep 2 only for schema/migration/resolver/security.
- **Drop** long reports. Cap at ~12 lines. The diff is the record.
- **Drop** re-reading the full `CLAUDE.md` per subagent — read `docs/superpowers/task-constraints.md` (the lean stable core) instead; open `CLAUDE.md` only when a task needs a section it points to.
- **Drop** full test code in briefs. Acceptance criteria (intent) only; the implementer writes tests once.
- **Drop** micro-tasks. Batch to commit-sized units (see batching rule).
- **Drop** per-task regeneration of the constraints block. Reference the one fixed file so it stays a **cacheable prefix**.

## Review-by-risk matrix

| Task type                                                                              | Review rounds  | Model  |
| -------------------------------------------------------------------------------------- | -------------- | ------ |
| Mechanical (renames, enum moves, CRUD mirroring an exemplar, contract regen)           | 0 (gates only) | strong |
| Normal feature (a service + endpoint + UI + tests)                                     | 1              | strong |
| High-stakes (Prisma schema, migrations/raw SQL, access resolver, auth, scoring, money) | 2              | strong |

## Model

**Strong model for ALL implementation and review.** A cheaper model does not meet the
coding standards here — do not downgrade the implementer to save tokens. The savings in
this workflow come from the other levers (batching, review-by-risk, cacheable prefix,
terse reports), never from a weaker model. A cheap model is acceptable ONLY for non-code
chores that cannot affect the codebase (e.g. drafting a terse report), and even that is
optional — default everything to strong.

## Task batching rule

One task = one commit-sized unit of coherent work (a module slice, a migration, one
screen), **not** a single function. Aim for ~6–8 tasks per plan, not ~18. Overhead is
per-task; halving the count nearly halves the ceremony. Keep tightly-coupled steps in one
task (schema+migration together); split only where a fresh context genuinely helps.

## Context & caching (the big token lever)

- Every subagent should read **`docs/superpowers/task-constraints.md`** (lean, ~1 page) as
  its binding core, not the full `CLAUDE.md`.
- Keep that core **byte-identical across tasks** so it lands in the prompt cache — then
  re-reads cost ~10%, not 100%. Never regenerate or vary the shared prefix per task.
- Each task lists the **exact files** it touches so subagents read only those, not whole
  modules.

## Lean task template (copy per task)

```
### Task N: <verb + outcome>
Risk: mechanical | normal | high        Model: cheap | strong        Reviews: 0 | 1 | 2
Exemplar: <path to the file to mirror, e.g. apps/api/src/students/students.service.ts>
Files: <exact create/modify/test paths>
Acceptance (behaviors, human-owned):
  - <observable outcome 1>
  - <the failure this prevents>
Invariant tests it must not break: <names from the golden suite, if any>
```

## Superpowers vs caveman — when to use which

- **Superpowers** (this lean loop, 2 reviews): schema, migrations, the access resolver,
  auth, scoring — anything hard to undo or logic-heavy.
- **Caveman** (direct, gates only, you review the diff): renames, enum moves, CRUD that
  mirrors an exemplar, UI screens, copy. No subagent fan-out.

## Per-run checklist

- [ ] Plan batched to ~6–8 tasks, each commit-sized.
- [ ] Each task tagged Risk / Model / Reviews and pointed at an exemplar.
- [ ] Shared constraints = the fixed `task-constraints.md` (stable, cached), not full CLAUDE.md.
- [ ] Acceptance criteria are behaviors, human-owned; no test code in the plan.
- [ ] Reports capped ~12 lines. Reviews per the matrix, not by default.
- [ ] Strong model everywhere (implementation + review). Savings come from batching + caching + review-by-risk + terse reports, never from a weaker model.
