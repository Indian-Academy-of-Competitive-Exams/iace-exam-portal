# Lean task workflow (optimized SDD)

The operating procedure for running tasks with the superpowers plugin **without** the ceremony
that made the audit-log run cost ~8 hours over ~18 tasks. Keep the quality superpowers gives; cut
the redundant steps; make token and wall-clock cost proportional to the task. Point every plan here.

<the-loop>

Per task, the minimum that still protects correctness:

1. **Intent check** (30s, human) — restate what you will build, in behaviours, in one short
   paragraph. Your human partner approves or corrects. Catches logical drift before any code.
2. **Implement + test in one pass** — one agent writes the code **and** its tests, against the
   task's acceptance criteria. Tests come from the criteria, never copied from the plan.
3. **Gates** — `format:check → lint → typecheck → test → build` (+ `db:*` for schema tasks).
   Green before review. They are objective, and they replace most review chatter.
4. **Review by risk, not by default** — see the matrix. A round reads the diff and the acceptance
   criteria only, never the whole module.
5. **Terse report** — ≤12 lines: what changed, gate status, any deviation from the criteria.
6. **Commit** — one per task.

Anything not on this list is optional and off by default.

</the-loop>

<cut-list>

Each of these was a real cost on the audit-log run. Do not reintroduce them:

- **Micro-tasks.** Per-task ceremony was paid 18×. Batch to commit-sized units.
- **Review rounds by default.** Mechanical and UI tasks get none; the gates are the check.
- **Long reports.** Nobody reads 900 lines. The diff is the record.
- **Re-reading the full `CLAUDE.md` per agent.** That file was read 90+ times. Read
  `docs/superpowers/task-constraints.md` — the lean, stable core — and open `CLAUDE.md` only for
  the section a task points at.
- **Test code in briefs.** Acceptance criteria (intent) only; the implementer writes tests once.
- **Regenerating the constraints block per task.** Reference the one fixed file so it stays a
  cacheable prefix.

</cut-list>

## Review by risk

| Task type                                                                              | Rounds         | Model  |
| -------------------------------------------------------------------------------------- | -------------- | ------ |
| Mechanical (renames, enum moves, CRUD mirroring an exemplar, contract regen)           | 0 (gates only) | strong |
| Normal feature (a service + endpoint + UI + tests)                                     | 1              | strong |
| High-stakes (Prisma schema, migrations/raw SQL, access resolver, auth, scoring, money) | 2              | strong |

<non-negotiable>

**Strong model for ALL implementation and review.** A cheaper model does not meet this repo's
coding standards — never downgrade the implementer to save tokens. The savings come from the other
levers: batching, the cacheable prefix, review-by-risk, terse reports. A cheap model is acceptable
only for non-code chores that cannot affect the codebase (drafting a terse report), and even that
is optional.

</non-negotiable>

## Batching

One task = one commit-sized unit of coherent work (a module slice, a migration, one screen) —
**not** a single function. Aim for ~6–8 tasks per plan, not ~18: overhead is per-task, so halving
the count nearly halves the ceremony. Keep tightly-coupled steps together (schema + migration);
split only where a fresh context genuinely helps.

## Context and caching

- Every agent reads **`docs/superpowers/task-constraints.md`** as its binding core, not full `CLAUDE.md`.
- Keep that core **byte-identical across tasks** so it lands in the prompt cache — re-reads then
  cost ~10%, not 100%. Never regenerate or vary the shared prefix per task.
- Each task lists the **exact files** it touches, so agents read only those, never whole modules.

## Task template

```
### Task N: <verb + outcome>
Risk: mechanical | normal | high        Model: cheap | strong        Reviews: 0 | 1 | 2
Exemplar: <the file to mirror, e.g. apps/api/src/students/students.service.ts>
Files: <exact create/modify/test paths>
Acceptance (behaviors, human-owned):
  - <observable outcome>
  - <the failure this prevents>
Invariant tests it must not break: <names from the golden suite, if any>
```

## Superpowers vs caveman

- **Superpowers** (this loop, 2 reviews): schema, migrations, the access resolver, auth, scoring —
  anything hard to undo or logic-heavy.
- **Caveman** (direct, gates only, your human partner reviews the diff): renames, enum moves, CRUD
  mirroring an exemplar, UI screens, copy. No agent fan-out.

## Per-run checklist

- [ ] Plan batched to ~6–8 commit-sized tasks.
- [ ] Each task tagged Risk / Model / Reviews and pointed at an exemplar.
- [ ] Shared constraints = the fixed `task-constraints.md`, not full `CLAUDE.md`.
- [ ] Acceptance criteria are behaviours, human-owned; no test code in the plan.
- [ ] Reports ≤12 lines. Reviews per the matrix, not by default.
- [ ] Strong model everywhere.
