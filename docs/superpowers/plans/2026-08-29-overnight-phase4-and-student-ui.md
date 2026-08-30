# Overnight runbook — Phase 4 (scoring, ranking, report) + the Student Tests experience

> **Nothing blocked. Everything below shipped, and it has been RUN against the real stack.**
> Docker was down for most of the session; it was started at the end and the whole run verified
> against Postgres, Redis and the live API. `pnpm db:check` reports no difference. `pnpm format:check`,
> `lint` (0 errors), `typecheck`, `test` (1561 passing) and `build` are green.
>
> **What was proved on real data** (200 seeded sittings, test `tst_cohort_1`):
> all-correct scores 50/50 and all-wrong scores −12.5, exactly as the paper prices them; two
> sittings tied on 50 marks are separated by 120 composite points, the 120 seconds between them;
> the board holds all 200 and, wiped and rebuilt from Postgres, comes back byte-identical; the
> score card carries no `options`, no `answerKey` and no correct option on a MISSED question;
> the solution gate serves once entry has closed and refuses with the window reopened, while the
> score card's `provisional` flag flips with it; and dropping question 25 through the real admin
> endpoint moved exactly 163 scores — the exact 163 who missed it — by exactly +1.25 each, never
> twice, with 189 ranks changing and the audit row naming the paper row and its ACTIVE → DROPPED.
>
> **Still not exercised:** the Sonar pre-commit gate, which skipped itself on every commit because
> its server (localhost:9004) is not in `docker-compose.yml` and was unreachable. No task in this
> run changed `prisma/schema.prisma`, so `db:migrate:deploy` was never a gate for any of them.
>
> **Two seeded students now have PINs**, set while verifying the read endpoints:
> `9500000000` / `4271` and `9500000002` / `5183`. A `--reset` of the seed drops them.

## Unattended rules (read first)

- **One task, one commit, green before moving on.** Never start a task until the previous is
  committed and all gates pass: `pnpm format:check && lint && typecheck && test && build`
  (schema tasks also `pnpm db:migrate:deploy` from scratch + `pnpm db:check`).
- **Stop on a blocker; do not guess.** If an acceptance criterion is ambiguous, a gate stays red
  after two honest attempts, or a decision has irreversible consequences not covered here: write a
  `BLOCKED: <task> — <why>` line at the TOP of this file, commit what is safely green, and move to
  the next task that does NOT depend on the blocked one (dependencies are noted per task). If none
  is independent, stop.
- **Stay in scope.** Build only the tasks below. No Phase 5 (the ThinkExam importer). No schema
  changes beyond the two named here (A2 leaderboard keys are Redis, not DB; A5 needs none —
  `PaperQuestion.status` already exists). Do not "improve" screens you were not asked to touch.
- **HIGH-stakes tasks keep 2 reviews even overnight** — scoring, the leaderboard, the solution-key
  gate, drop/bonus recompute. Correctness here is money-like; a green test is not enough.
- **The invariants that cannot break** (grep-check in C1): the answer key never leaves the server
  except in the gated Solution Report (A4); no Postgres write on the live-answer path; rank and
  percentile read live from Redis; `no-hot-path-db-write` and `no-floating-promises` stay green.

## Prerequisites — seed a scoreable cohort (do this FIRST, as task P0)

Scoring, rank and percentile need real submitted attempts to compute against, or nothing downstream
is verifiable overnight.

**P0 — dev cohort seed** · mechanical · Exemplar: `scripts/dev-seed-golden-questions.mjs`,
`scripts/dev-seed-questions.mjs` (local-DB guard, `--reset`).
Create `scripts/dev-seed-cohort.mjs`: finalize ONE test from the dummy/golden pool (walk the real
finalize path or insert a locked ACTIVE test + its `PaperQuestion` rows), then create ~200 `Attempt`

- `AttemptQuestion` rows in `SUBMITTED` state with `isGraded: true` and varied `selectedOptionId`
  (a spread of scores, some unattempted, some all-correct), each carrying a `SCORING_REQUEST`
  `OutboxEvent` so the relay/worker will pick them up. Local-`DATABASE_URL` guarded, `--reset`-able,
  tagged so it purges cleanly. **Acceptance:** after A1+A2 land, running scoring over this cohort
  produces a full leaderboard the morning check can eyeball.

---

## Part A — Phase 4 back end (do first; verify hard)

### A1 — The scoring worker (idempotent) · HIGH · 2 reviews

Fill the no-op `ScoringProcessor`. Exemplar: `attempt-flush.processor.ts` (processor shape),
`finalize.service.ts` (optimistic write), `draw-engine.ts` (a pure rule module + truth-table test).
Split: a **pure `score-paper.ts`** (paper rows + answers + dispositions → per-question result +
totals + section scores) with a truth-table test, and the processor that persists into
`AttemptQuestion` (`isCorrect`, `marksAwarded`) and `Attempt` (`score`, `correctCount`,
`wrongCount`, `unattemptedCount`, `sectionScores`).
Semantics: correct → +marks; wrong → −negativeMarks; unattempted → 0. `PaperQuestion.status`
DROPPED → award marks to everyone who **attempted**, reverse any negative; BONUS → award to **all**
candidates. **Idempotent** — re-running over the same attempt writes the same rows.
**Acceptance:** the cohort scores exactly per the paper; a second run changes nothing; no evaluation
in any request path.

### A2 — Leaderboard + live rank/percentile · HIGH · 2 reviews

Depends on A1. Exemplar: `redis.service.ts` / `redis.keys.ts` (keys named centrally),
`attempt-state.service.ts` (Redis usage). Add a `leaderboard(testId)` sorted-set key + a percentile
key to `redis.keys.ts`.
Split: a **pure module** for the composite score (marks major, `maxTime − timeTaken` minor, packed
into one double so higher marks always win and less time breaks ties) + percentile math, with a
truth-table test; a service that ZADDs on scored (**`isGraded` only**), reads rank
(`ZREVRANK`+1) and percentile live, snapshots into `Attempt.lastRank`/`lastPercentile`, and a
**rebuild job** that reconstructs the set from the durable `Attempt.score` + time.
**Acceptance:** two equal-marks attempts order by time; rank/percentile match a hand count over the
cohort; a wiped Redis rebuilds identically.

### A3 — Score Card API + own-answer evaluation · normal · 1 review

Depends on A1/A2. Exemplar: `attempt-paper.service.ts` (answer-key-free payload discipline),
`me.controller.ts`. `GET /me/attempts/:id/scorecard` behind a scored gate returns marks, live rank
(flagged **provisional** while the test window is open), percentile, correct/wrong/unattempted,
section-wise, and **per-question right/wrong on the student's own answers** — carrying **no correct
option** for a question they missed (prove by test).

### A4 — Solution Report API (gated) · HIGH · 2 reviews

Depends on A1. This is the ONE endpoint the answer key rides on. Exemplar: the gate-derivation style
in the access resolver; `attempt-paper.service.ts`. `GET /me/attempts/:id/solutions` returns correct
option + explanation + chosen + time-per-question **only** once the gate opens — for a scheduled
test, after its window closes; for practice/standalone, immediately. Before the gate it refuses
without leaking. The gate is a pure, tested function.
**Acceptance:** a scheduled test's solutions are refused before close and served after; a practice
test serves immediately; no key escapes the gate.

### A5 — Drop/Bonus admin + recompute · HIGH · 2 reviews

Depends on A1. Exemplar: `test-builder-paper.tsx` (admin paper view), `finalize.service.ts` (the
only permitted post-lock change), the `audit` module. An admin marks a `PaperQuestion` DROPPED/BONUS
on a locked test; every graded attempt re-scores through the idempotent A1 worker (re-enqueue via
the outbox); the leaderboard rebuilds (A2); the change is audit-logged; a non-locked or unrelated
edit is still refused.
**Acceptance:** one dropped question moves every affected score and every rank, exactly once.

### A6 — Analytics API (derived) · normal · 1 review

Depends on A1/A2. Exemplar: `stats.ts` contract module; the `StudentStat`/`StudentSubjectStat`/
`TestStat`/`TestSectionStat`/`TestQuestionStat` models already exist. Pure derivations from
`AttemptQuestion` (option, state, `timeSpentSec`) + question meta (subject, difficulty) + the
leaderboard: per-attempt accuracy (overall/section/subject/difficulty), time management (avg per
question, time on correct vs wrong), attempt strategy (marked / revisited), cohort comparison
(you vs topper/average/percentile band), and a cross-test trend series. Endpoints under `me`.
**Acceptance:** every number is reproducible from captured data; no new instrumentation.

---

## Part B — The Student Tests experience (consumes Part A; match the shell + the agreed IA)

**Two layers, and keep them separate — external shell, internal Netflix.**

- **Externally (the frame): obey the existing app shell, no deviation.** The
  `@iace/app-kit/browser` `AppShell` (icon rail, brick Brandmark, header), `PageHeader` +
  breadcrumbs, `max-w-[100rem]`, the fixed-frame scroll model, and standard `@iace/ui` primitives
  (Button, Badge, Card) at their real sizes and tokens. Never invent chrome outside the shell.
- **Internally (the content): a Netflix-inspired browse design** — horizontal **series shelves** of
  test tiles, a **Continue / Open now / Up next** status strip, card-first discovery — composed FROM
  the design tokens and standard primitives, not new ones.
- This is a **deliberate, stated deviation** from the standard list-screen convention
  (`TableFrame` + `ListView`): the student portal is discovery, not an admin data table (CLAUDE.md:
  "enhanced, not copied — snappy, uncluttered, icon-driven"). Do NOT force the shelves into
  `TableFrame`/`ListView`; do keep the frame, header, scroll model and tokens exactly.

Add a **Performance** nav row to `NAV_ITEMS` (icon `BarChart3`), route `/performance`; the tabs are
Tests · Performance · Free tests, and `/` stays the lean-analytics landing. The agreed wireframe is
the layout intent — build it from these specs and the real components.

### B1 — Tests home: status strip + series shelves + search · normal · 1 review

Depends on the existing catalog (already built). This **evolves `apps/test/src/routes/tests.tsx`**
from the current buckets into: a central search bar + the exam-family **filter** (not a nav step);
a **status strip** (Continue / Open now / Up next) as the daily action; then **series shelves** —
each a series header (name + progress + "Open series") over a horizontal row of test tiles. Tile
body → the About page; the tile button does the direct thing (Start / Resume / Review / "Waiting its
turn"). Reuse the existing bucketing helper; keep it pure.
**Acceptance:** the daily action is one tap; family is a filter; a sequential-locked test reads as
"Waiting its turn", not an error. Manual check — say what to click.

### B2 — Series page (full page) · normal · 1 review

Depends on catalog. `PageHeader` + breadcrumbs; series overview + progress; the ordered list of
tests as "episodes" with per-test status/stats and the sequential lock shown plainly; a rail with
"your standing here" linking into Performance.

### B3 — Test About page (pre-pre-test) · normal · 1 review

Depends on catalog. The overview of what the test covers (sections × Q/marks), key facts, window,
how-others-did — **nothing timed**. Two exits: **Proceed to test** (→ the existing instructions
page → exam) and **View past attempts** (→ B4). No palette legend or declaration here.

### B4 — Score Card page + Solution Report review · normal→HIGH · 2 reviews

Depends on A3/A4. The Score Card page (rank, percentile, correct/wrong/unattempted, section-wise)
consuming A3 — provisional rank labelled while the window is open. "View past attempts" and the
Solution Report **render the attempt in the CBT exam layout** (reuse the exam engine/template in a
read-only review mode): immediately, the student's own answers + correctness; after the window
closes (A4's gate), the correct option + explanation per question. The gate state drives what the
review shows.
**Acceptance:** before close, the review shows own-answers only (no correct option on a miss);
after close, full solutions; the same page does both.

### B5 — Performance tab + lean dashboard · normal · 1 review

Depends on A6. **Invoke `dataviz` before any chart.** The Performance tab is the full analytics
surface (accuracy trends, subject/difficulty strengths, time management, cohort comparison); the
`/` dashboard mirrors only the headline numbers (last rank, accuracy trend, tests done) as the
lean echo. Charts use the colorblind-safe palette, never brand red.
**Acceptance:** every figure traces to A6; the dashboard is a strict subset.

### B6 — Free tests tab · mechanical · 0–1 review

Mirror B1's structure for free series (the existing `/free-tests` browse), so free content reads the
same as paid but in its own tab.

---

## Part C — Integration + close-out

### C1 — End-to-end + invariants + green · — · 1 review

End-to-end through the fakes: seed cohort → score → rank → scorecard → gated solutions → drop a
question → ranks move. Invariants by test where possible and by grep where not: no answer key in the
scorecard payload; the key only in the gated solutions endpoint; no Postgres write on the answer
path; the client never computes a deadline; no raw hex / narration in the new screens. Full gates +
`pnpm db:check` green from a clean checkout. One commit:
`chore(phase4): scoring, ranking, report + student tests experience — end-to-end green`.

---

## Morning acceptance checklist (for Harshith)

- [ ] **Scoring correctness:** open two seeded attempts — one strong, one weak — and check marks,
      negative marking, and unattempted = 0 by hand against the paper.
- [ ] **Rank/percentile:** the leaderboard orders by marks then time; a tie is broken by speed;
      percentile is over graded attempts only. Rebuild-from-Postgres gives the same order.
- [ ] **No key leak:** the Score Card response for a _missed_ question carries no correct option
      (check the network payload, not just the screen). The Solution Report is refused before the
      window closes and served after.
- [ ] **Drop/Bonus:** mark one question DROPPED in admin → every affected score and rank updates,
      once.
- [ ] **UI vs the wireframe:** the Tests home, Series page, and About page match the agreed layout
      inside the real shell (icon rail, brick plate, standard components), in both light and dark.
      The Solution Report renders in the CBT layout.
- [ ] **Gates:** `pnpm lint && typecheck && test && build` green; `pnpm db:check` clean; the
      invariant greps in C1 return nothing.
- [ ] Read any `BLOCKED:` line at the top of this file first.

## What deliberately waits (not tonight)

The ThinkExam question importer (Phase 5), pre-launch security hardening (default PIN, CORS
fail-closed, upload magic-bytes, DOMPurify), the load test at target concurrency, and a mobile pass
of the student screens.
