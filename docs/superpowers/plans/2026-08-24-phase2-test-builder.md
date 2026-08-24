# Phase 2 — Test builder — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development` (or run caveman per `docs/superpowers/WORKFLOW.md`). Steps use checkbox (`- [ ]`) tracking.

**Goal:** Config-driven test creation. An admin picks a seeded `BaseConfig`, the ONE draw
engine assembles a paper (auto-draw by subject/difficulty or manual pick) that satisfies the
config's section counts, the test is finalized (FIXED papers freeze into `PaperQuestion`),
and it's scheduled/offered through a series + per-branch window. **Milestone:** a publishable
bilingual mock test, assembled from the bank, exists.

**Base configs are already done** (30 seeded via `prisma/seed.catalog.sql`). This phase
builds only the **test builder** — greenfield: there is no `tests` module yet.

## Prerequisites

- `pnpm db:seed` run (30 configs + catalog present).
- A question pool to draw from (you are loading this). Auto-draw works with any pool size;
  a few hundred SSC CGL T1 questions is enough to build and demo the whole flow.
- The importer (images/math) is **NOT** a dependency — it only makes the pool bigger.

## Binding / workflow

Read `CLAUDE.md`, `docs/superpowers/task-constraints.md`, `docs/superpowers/WORKFLOW.md`,
`prisma/schema.prisma` (source of truth). Model: opus throughout. Lean loop per task:
intent check → implement+tests → gates → review-by-risk → terse report → one commit.

---

## Sessions & estimates (lean loop, strong model)

| Session                                    | Tasks                                                   | Est.         |
| ------------------------------------------ | ------------------------------------------------------- | ------------ |
| **P2-S1 — Tests module + Step 1 (create)** | T1 tests module + Test CRUD, T2 Step-1 create UI        | 1.25 – 2 d   |
| **P2-S2 — Draw engine (the core)**         | T3 draw engine, T4 manual pick                          | 2.25 – 3.5 d |
| **P2-S3 — Finalize + schedule**            | T5 finalize/freeze (FIXED), T6 series + branch schedule | 1.75 – 2.5 d |
| **P2-S4 — Builder UX + integration**       | T7 Step-2 draw UI, T8 integration/milestone             | 1 – 2 d      |

**Total ≈ 6.25 – 10 focused working days.** The swing is **T3 (draw engine)** — the one
piece of real logic. Everything else is CRUD + UI over a schema that's already built.

### The "today" thin slice (one focused day)

If the goal is a demonstrable Phase-2 milestone **today**, build the happy path only:
**T1 (create draft from config) → T3 RANDOM-only draw → T5 FIXED finalize → T6 minimal
schedule → T8 smoke check.** Skip manual pick, the non-RANDOM strategies, and Step-2 polish
(T4, T7, and T3's extra strategies) for the follow-up days. That yields "a config becomes a
frozen, scheduled paper" end-to-end.

---

## P2-S1 — Tests module + Step 1

### Task 1: `tests` module + Test CRUD (create draft from a config)

**Risk:** normal · **Reviews:** 1 · **Model:** opus · **Est:** 0.75–1.25 d
**Exemplar:** `apps/api/src/configs/*` and `apps/api/src/students/*` (module/controller/service/rules shape); contracts in `packages/contracts/src`.
**Files:** create `apps/api/src/tests/{tests.module,tests.controller,tests.service,test-rules}.ts`, `apps/api/src/tests/index.ts`, `apps/api/test/tests-service.unit.test.ts`; `packages/contracts/src/tests.ts`.

- [ ] Create a **draft** `Test` from a `baseConfigId`: copy/inherit nothing that lives on the config (marks/duration/timing/structure are read through the config at run time); set `examStageId` (= config's), `scope` (default FULL), `scopeRef`, `evaluationMode` (default RANKED), `paperBinding` (default FIXED), `maxRetakes`, `drawStrategy` (default RANDOM), `questionPoolFilter`. Status DRAFT.
- [ ] Enforce invariants in `test-rules.ts`: **RANKED ⇒ FIXED** (reject otherwise); a Test must reference a real, active config of the given stage (the composite FK already guards stage agreement). `RequiresFeature(TEST_MANAGEMENT-or-equivalent, WRITE)`.
- [ ] Tests: create-from-config succeeds and inherits the config's shape; a RANKED+GENERATED create is rejected.
      **Acceptance:** POST creates a DRAFT test bound to a config; the wrong evaluation/binding combo is refused.

### Task 2: Step-1 create screen (admin)

**Risk:** normal · **Reviews:** 1 · **Est:** 0.5–0.75 d
**Exemplar:** an existing admin route (e.g. `apps/admin/src/routes/taxonomy.tsx` / configs screen) + `packages/ui`.
**Files:** `apps/admin/src/routes/tests*.tsx`, shared bits into `packages/ui` if two screens need them.

- [ ] Pick exam → stage → **config** (shows the config's shape read-only: sections, counts, timer, languages), then scope + evaluation mode + binding → create draft. Cancel = neutral grey; confirm destructive per `ConfirmDialog`.
- [ ] Tests: the picker only offers active configs for the chosen stage; RANKED forces FIXED in the UI.
      **Acceptance:** an admin assembles a draft test from a seeded config on screen.

---

## P2-S2 — The draw engine (the core)

### Task 3: The ONE draw engine (pure service)

**Risk:** HIGH · **Reviews:** 2 · **Est:** 1.5–2.5 d
**Exemplar:** `apps/api/src/access/*` (a pure, unit-tested service) for shape; the engine itself is greenfield.
**Files:** `apps/api/src/tests/draw-engine.ts`, `apps/api/test/draw-engine.unit.test.ts`.

- [ ] One function that, given a config's sections + a `questionPoolFilter` + a `drawStrategy`, selects questions **per section to the section's exact `questionCount`**, honoring subject/difficulty/topic/tag filters. Return the selected set (question + pinned `currentVersionId` + section + order + marks copied from the config section) — **or a structured shortfall** ("section X needs 25, pool has 18"), never a silently short/over-filled paper.
- [ ] Strategies: **RANDOM** first (uniform from the filtered pool). Then `NEWEST_FIRST` (recent `createdAt`), `LEAST_SERVED` (`fixedUseCount` asc), `UNSEEN_FIRST` (exclude a student's seen set — the same function Phase-3 GENERATED will call per attempt; here it's the finalize-time draw). Keep the function reusable by both FIXED finalize and future GENERATED attempts.
- [ ] Tests (truth-table): each strategy fills every section to count; a thin pool returns the exact shortfall; no duplicate question within a paper; marks/version come from the config + question, not invented.
      **Acceptance:** the engine deterministically fills a config's sections from a pool, or reports precisely why it can't. **This is the task to review hardest.**

### Task 4: Manual pick

**Risk:** normal · **Reviews:** 1 · **Est:** 0.75–1 d
**Files:** `apps/api/src/tests/*` (manual-select endpoint), bank search reuse from `apps/api/src/questions/*`.

- [ ] Select specific questions per section from the bank (search by subject/difficulty/tags/text), enforcing the section's count; mix with auto-draw (fill the rest). Reuses the draw engine's count/validation.
- [ ] Tests: a manual paper that violates a section count is rejected; a valid manual+auto mix is accepted.
      **Acceptance:** an admin can hand-pick a section and auto-fill the rest.

---

## P2-S3 — Finalize + schedule

### Task 5: Finalize / freeze (FIXED)

**Risk:** HIGH · **Reviews:** 2 · **Est:** 1–1.5 d
**Files:** `apps/api/src/tests/finalize.service.ts`, `apps/api/test/finalize.unit.test.ts`.

- [ ] For a FIXED test: freeze the drawn set into **`PaperQuestion`** (testId, baseConfigId, baseConfigSectionId, questionId, **questionVersionId pinned**, order, marks, negativeMarks copied from the config section). Set `Test.isLocked=true`, `finalizedAt`, bump the optimistic `version` via conditional UPDATE so concurrent finalizes resolve to one winner.
- [ ] **Lock the config on first finalize** (`BaseConfig.locked=true`) — the trigger/clone-to-evolve rule; increment `Question.fixedUseCount` **atomically** for each frozen question.
- [ ] GENERATED tests do **not** freeze here (their pool filter is stored; the draw runs per attempt in Phase 3).
- [ ] Tests: finalize writes exactly `totalQuestions` paper rows with pinned versions; a second concurrent finalize is a no-op; the config is locked afterward; `fixedUseCount` increments once per question.
      **Acceptance:** a FIXED test finalizes into a frozen, reproducible paper and locks its config.

### Task 6: Schedule + offering

**Risk:** normal · **Reviews:** 1 · **Est:** 0.75–1 d
**Files:** `apps/api/src/tests/*` (attach-to-series + schedule), `apps/admin/src/routes/*` (Step 3), reuse `apps/api/src/access/*` for series/branch.

- [ ] Attach the test to ≥1 `TestSeries` via `TestSeriesTest` (order); set availability through `BranchTestConfig` (per-branch enable + start/end window). Status DRAFT → ACTIVE.
- [ ] Tests: a test with no series is refused ACTIVE (no standalone offering); a branch window with end<start is refused.
      **Acceptance:** a finalized test is offered through a series with a per-branch schedule.

---

## P2-S4 — Builder UX + integration

### Task 7: Step-2 draw UI (auto-draw preview + override)

**Risk:** normal · **Reviews:** 1 · **Est:** 0.5–1 d
**Files:** `apps/admin/src/routes/tests*.tsx`.

- [ ] Show the per-section fill from the engine, **shortfall warnings** inline, a `drawStrategy` picker, re-draw, and manual override per section. Nothing here changes scoring — it drives the engine.
- [ ] Tests: the UI surfaces a shortfall rather than letting the admin finalize an incomplete paper.
      **Acceptance:** the admin sees the draw, its gaps, and can fix them before finalizing.

### Task 8: Integration / milestone

**Risk:** — · **Reviews:** 1 · **Est:** 0.5–1 d

- [ ] End-to-end: seeded config → draft test → auto-draw → finalize (freeze) → attach to series + branch schedule → a **publishable mock exists**. Full gates green from clean checkout; `pnpm db:check` clean.
- [ ] Grep for dead ends; confirm RANKED⇒FIXED and one-frozen-paper hold. One commit: `chore(tests): phase-2 builder end-to-end green`.
      **Acceptance:** the Phase-2 milestone is demonstrable.

---

## Session prompts

### P2-S1

```
Run Phase-2 Session S1 — tests module + Step 1. Execute T1, T2 from docs/superpowers/plans/2026-08-24-phase2-test-builder.md.
Binding: CLAUDE.md, task-constraints.md, WORKFLOW.md, prisma/schema.prisma. Model: opus. Lean loop.
Exemplar: apps/api/src/configs/* and apps/api/src/students/* (module shape); an existing admin route for the screen.
- T1 (normal,1): tests module + Test CRUD — create a DRAFT Test from a baseConfigId; inherit shape from the config; scope/evaluationMode/paperBinding/maxRetakes/drawStrategy/questionPoolFilter; enforce RANKED⇒FIXED. Contracts in packages/contracts/src/tests.ts. Tests per acceptance.
- T2 (normal,1): Step-1 admin screen — exam→stage→config picker (config shape read-only) → create draft.
Intent check before each. One commit per task.
```

### P2-S2

```
Run Phase-2 Session S2 — draw engine. Execute T3, T4. Binding + lean loop + opus. HIGH STAKES on T3 — 2 reviews.
Exemplar: apps/api/src/access/* (pure, unit-tested service).
- T3 (HIGH,2): the ONE draw engine (apps/api/src/tests/draw-engine.ts) — fill each config section to its exact questionCount from a filtered pool per drawStrategy (RANDOM first; then NEWEST_FIRST/LEAST_SERVED/UNSEEN_FIRST), returning the selected set OR a structured shortfall; reusable by FIXED finalize and future GENERATED attempts. Truth-table tests.
- T4 (normal,1): manual pick — select questions per section, enforce counts, mix with auto-draw.
Intent check before each. One commit per task.
```

### P2-S3

```
Run Phase-2 Session S3 — finalize + schedule. Execute T5, T6. Binding + lean loop + opus. HIGH STAKES on T5 — 2 reviews.
- T5 (HIGH,2): finalize/freeze — for FIXED, freeze the drawn set into PaperQuestion with pinned questionVersionId + copied marks; set isLocked/finalizedAt; bump optimistic version; lock the config on first finalize; atomic fixedUseCount++. GENERATED does not freeze. Tests: exact paper size, concurrent-finalize no-op, config locked, fixedUseCount once.
- T6 (normal,1): schedule/offering — attach to TestSeries (TestSeriesTest) + BranchTestConfig window; DRAFT→ACTIVE; refuse ACTIVE with no series and end<start windows.
Intent check before each. One commit per task.
```

### P2-S4

```
Run Phase-2 Session S4 — builder UX + integration. Execute T7, T8. Binding + lean loop + opus.
- T7 (normal,1): Step-2 draw UI — per-section fill, shortfall warnings, drawStrategy picker, manual override.
- T8 (—,1): integration — config→draft→draw→finalize→series+branch schedule; full gates green; db:check clean; one commit.
Intent check first.
```

## What Phase 2 deliberately leaves to Phase 3

The **live exam engine** runs the GENERATED per-attempt draw (calling T3's engine), the
server-authoritative timer, Redis autosave, and safe submit. Phase 2 builds the shared draw
function + the FIXED freeze; it does not run an attempt.
