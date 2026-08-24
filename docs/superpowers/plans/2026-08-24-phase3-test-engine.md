# Phase 3 — Test engine — implementation plan

> **For agentic workers:** run the lean loop per `docs/superpowers/WORKFLOW.md`. Steps use
> checkbox (`- [ ]`) tracking. Acceptance criteria are BEHAVIOURS — the implementer writes the
> tests, and no test code appears in this file (WORKFLOW's cut list).

**Goal:** The live exam. A student opens a test they can reach, sits it with a
server-authoritative clock, answers with everything held in Redis, and submits — safely, or by
the server's hand when the clock runs out. **Milestone:** a student takes a full bilingual
sectional-timed test start to finish.

**Requirements live in** `docs/01-architecture-and-plan.md` §8 (the phase's own paragraph),
`docs/02-mocktest-feature-spec.md` §5 (the student journey and the live exam UI) and §14 (why
there is one CBT screen and not a theme gallery), and `prisma/schema.prisma`, which already holds
every table this phase writes. There is no separate design doc — WORKFLOW cuts that ceremony.

**Where it stops:** at SUBMIT. Scoring, the score card, solutions and the leaderboard are Phase 4.
`ScoringProcessor` stays the no-op it is today; Phase 3 only enqueues into it.

## What Phase 2 already built that this leans on

- **A frozen paper.** `PaperQuestion` rows with a pinned `questionVersionId`, so what a student
  sits reproduces after the question is edited.
- **`AccessResolverService.catalog(studentId)` and `.assertCanStart(studentId, testId)`** — the
  reach and window rules are DONE. Every access controller is `admin/*`, so the only thing missing
  is a student-facing route onto them. `apps/api/src/me/me.controller.ts` is the precedent.
- **The draw engine** (`apps/api/src/tests/draw-engine.ts`) already takes a `seen` set, for the
  GENERATED draw this phase deliberately does not build.
- **The optimistic-lock pattern** in `apps/api/src/tests/finalize.service.ts`: one conditional
  `updateMany` picks a winner, the loser reports the winner's outcome. Submit reuses it exactly.

## Prerequisites

- A finalized, ACTIVE test carried by a series, with a `BranchTestConfig` window open for the
  student's branch. Phase 2's builder produces one; **there are 0 `TestSeries` rows in the dev
  database today**, so create one on the Test series screen first.
- `pnpm db:seed` run. The schema needs NO migration for this phase — `Attempt`, `AttemptQuestion`,
  `sectionState`, `shuffleSeed` and `AnswerState` are already in `prisma/schema.prisma`.

## Binding / workflow

Read `CLAUDE.md`, `docs/superpowers/task-constraints.md`, `docs/superpowers/WORKFLOW.md`,
`prisma/schema.prisma` (source of truth), and for the screens the `ui-conventions` skill.
Model: opus throughout. Lean loop per task: intent check → implement+tests → gates →
review-by-risk → terse report → one commit.

<decisions>

Settled before the plan was written. Do not re-open them mid-phase:

- **Durability: Redis live, plus a periodic flusher.** Answers land in Redis on autosave; a BullMQ
  repeatable job upserts `AttemptQuestion` from Redis every ~60s and again at submit. That job is
  the "single writer" the `AttemptQuestion` schema comment names. A Redis loss costs at most a
  minute, not the whole sitting.
- **Auto-submit: a server sweeper.** A repeatable job finds `IN_PROGRESS` attempts past `endsAt`
  and submits them. The server already owns `endsAt`; it owns the deadline passing too. The client
  submits promptly in the common case, the sweeper is the backstop for a closed tab.
- **GENERATED is deferred.** RANKED implies FIXED, so every ranked mock already has a frozen
  paper; GENERATED serves only PRACTICE. Adding it later is small — the engine already takes `seen`.
- **Timer templates: `COMPOSITE_FREE` and `SECTIONAL_LOCKED` only.** One clock with free
  navigation (SSC CGL T1) and a clock per section that locks when it ends (Banking).
  `SESSION_MODULE_LOCKED` is called deferred by the schema itself; `PER_ITEM_TIMED` is not V1.
- **CBT interface only.** `docs/02` §14 calls the generic test UI a nice-to-have that is never a
  blocker. It is out of this phase.

</decisions>

<invariants>

The scaling rules from `CLAUDE.md` are what this phase exists to honour. Breaking one is a bug
however green the tests are:

- The timer is CLIENT-side; the server owns `startedAt`/`endsAt` and is the only thing that
  decides whether a write is still in time.
- Autosave to **Redis** every ~20–30s. **Never** write Postgres per answer.
- On submit, enqueue a BullMQ scoring job. Workers do the evaluating — not the request.
- **The answer key never leaves the server during an attempt.** Not in the paper payload, not in
  an error, not in a debug field.

</invariants>

---

## Sessions & estimates (lean loop, strong model)

| Session                              | Tasks                                     | Est.      |
| ------------------------------------ | ----------------------------------------- | --------- |
| **P3-S1 — The attempt, server-side** | T1 lifecycle, T2 catalog + paper delivery | 1.5 – 2 d |
| **P3-S2 — Live state**               | T3 Redis state + autosave, T4 the flusher | 1.5 – 2 d |
| **P3-S3 — Ending an attempt**        | T5 submit + sweeper, T6 pre-exam screens  | 1.5 – 2 d |
| **P3-S4 — The exam screen**          | T7 the CBT screen, T8 integration         | 2 – 3 d   |

**Total ≈ 6.5 – 9 focused working days.** The swing is **T7** — one screen carrying the timer,
the palette, section navigation, language and autosave at once, and the one students judge us on.

### The "today" thin slice (one focused day)

For a demonstrable Phase-3 milestone today: **T1 → T2 → T3 → T5 (submit only, no sweeper) → a
throwaway page that renders one question and posts an answer.** That yields "a student starts,
answers, submits, and the row is durable" end to end. Skip the palette, sectional timing, the
flusher and the sweeper for the follow-up days.

---

## P3-S1 — The attempt, server-side

### Task 1: Attempt lifecycle — start and resume

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus · **Est:** 0.75–1.25 d
**Exemplar:** `apps/api/src/tests/finalize.service.ts` (the conditional-update winner);
`apps/api/src/tests/tests.service.ts` (module shape); `apps/api/src/me/me.controller.ts` (a
STUDENT-actor controller).
**Files:** create `apps/api/src/attempts/{attempts.module,attempts.controller,attempts.service,attempt-rules}.ts`,
`apps/api/src/attempts/index.ts`, `apps/api/test/attempts-service.unit.test.ts`;
`packages/contracts/src/attempts.ts` (exists — extend it); register in `apps/api/src/app.module.ts`.

- [ ] `POST /me/tests/:testId/attempt` starts one, gated by `AccessResolverService.assertCanStart`
      — the catalog's own resolution, so the two can never disagree.
- [ ] The server computes `endsAt` from the config's `durationSec`, and `startedAt` is its own
      clock. **Nothing about timing comes off the request.** Set `shuffleSeed`, `languages`
      (from the config's `languages`, narrowed by what the student picked), `status: IN_PROGRESS`.
- [ ] Seed one `AttemptQuestion` per `PaperQuestion`, carrying `paperQuestionId`, the pinned
      `questionVersionId`, `baseConfigSectionId` and `order`, at `state: NOT_VISITED`.
- [ ] **Idempotent.** A second start while one is IN_PROGRESS RESUMES it and returns the same
      attempt — never a second row, never a fresh clock. Two concurrent starts resolve to one
      attempt (the `@@unique([testId, studentId, attemptNo])` is the backstop; do not rely on it
      for the message).
- [ ] `maxRetakes` is enforced across finished attempts; `isGraded` is true for the FIRST attempt
      only, because the cohort rollup fires on it alone.
- [ ] Refuse: a test that is not ACTIVE, one whose paper is not frozen, a GENERATED test (not this
      phase — say so plainly), and a student the resolver refuses.
      **Acceptance:** a student starts a test once and gets a clock the server set; starting again
      returns the same attempt with the same deadline; a student who cannot reach the test is
      refused with the resolver's own reason.

### Task 2: The student catalog, and delivering the paper

**Risk:** HIGH · **Reviews:** 2 · **Est:** 0.75 d
**Exemplar:** `apps/api/src/me/me.controller.ts`; `apps/api/src/tests/paper.service.ts` (how a
paper is read and shaped).
**Files:** create `apps/api/src/attempts/attempt-paper.service.ts`,
`apps/api/test/attempt-paper.unit.test.ts`; modify `apps/api/src/access/access.controller.ts`
(add a STUDENT-actor controller), `packages/contracts/src/attempts.ts`,
`packages/contracts/src/client.ts`.

- [ ] `GET /me/catalog` exposes `AccessResolverService.catalog(studentId)`. The resolver already
      does the work — this is a route, not a re-implementation.
- [ ] `GET /me/attempts/:id/paper` serves the questions of the student's OWN attempt: stem and
      options from the pinned `QuestionVersion`, localized to the attempt's `languages`, ordered
      by `order`, shuffled per `shuffleSeed` where the config says to shuffle.
- [ ] **The answer key never appears in the payload.** Neither does `isCorrect` or `marksAwarded`.
      A student holding the response must not be able to read the answer out of it.
- [ ] Per-question the payload carries what the screen shows: marks, negative marks, section,
      type, and the languages that question actually has.
- [ ] Refuse another student's attempt with NOT_FOUND, never FORBIDDEN — an id is not a thing to
      confirm the existence of.
- [ ] Tests: the shape a student receives holds no answer key under any config; the same
      `shuffleSeed` gives the same order twice; two seeds differ.
      **Acceptance:** the exam screen can be built from this one response, and nothing in it tells
      a student what the answers are.

---

## P3-S2 — Live state

### Task 3: Redis attempt state + autosave

**Risk:** HIGH · **Reviews:** 2 · **Est:** 1–1.5 d
**Exemplar:** `apps/api/src/redis/redis.keys.ts` (every key is named there, never inline);
`apps/api/src/tests/draw-engine.ts` (a pure rule module with a truth-table test).
**Files:** create `apps/api/src/attempts/attempt-state.ts` (PURE merge rules),
`apps/api/src/attempts/attempt-state.service.ts` (Redis), `apps/api/test/attempt-state.unit.test.ts`;
modify `apps/api/src/redis/redis.keys.ts`, `packages/contracts/src/attempts.ts`.

- [ ] Add the keys to `redisKeys`: the attempt's live state, and the set of attempts with unflushed
      writes. **No key string is built at a call site.**
- [ ] `PATCH /me/attempts/:id/state` takes a BATCH — answers changed since the last save, per
      question `state`, `selectedOptionId`/`typedAnswer` and `timeSpentSec`, plus the section
      state. It writes Redis and nothing else.
- [ ] The merge rules are a pure module: which `AnswerState` a change produces (a cleared response
      returns to NOT_ANSWERED, marking keeps the answer, ANSWERED_MARKED is a real state),
      `timeSpentSec` accumulates and never decreases, and a stale batch never overwrites a newer one.
- [ ] The server decides whether a write is still in time: past `endsAt` plus a small grace it is
      refused, because a request in flight as the clock expires is not cheating. The grace is a
      named constant, not a number in a branch.
- [ ] Refuse a batch for an attempt that is not IN_PROGRESS, and another student's attempt.
- [ ] Tests (truth-table): every state transition the bottom bar can produce; time only ever
      accumulates; a late batch is refused; a batch out of order does not move the state backwards.
      **Acceptance:** a full sitting's answering never touches Postgres, and the state Redis holds
      is exactly what the palette should draw.

### Task 4: The flusher — Redis to `AttemptQuestion`

**Risk:** normal · **Reviews:** 1 · **Est:** 0.5–0.75 d
**Exemplar:** `apps/api/src/queue/scoring.processor.ts` (a processor's shape);
`apps/api/src/queue/queues.ts` (`QUEUE_NAMES` is code-owned).
**Files:** create `apps/api/src/attempts/attempt-flush.processor.ts`,
`apps/api/test/attempt-flush.unit.test.ts`; modify `apps/api/src/queue/queues.ts`,
`apps/api/src/queue/queue.module.ts`.

- [ ] A BullMQ **repeatable** job, every ~60s: take the attempts marked dirty, read their Redis
      state, and UPSERT `AttemptQuestion` rows for what changed. One writer, so two flushes cannot
      interleave into a half-written attempt.
- [ ] **Idempotent.** Running it twice over the same state writes the same rows and changes
      nothing the second time — it is a repeatable job, so it WILL run over unchanged state.
- [ ] It never writes an attempt that has been submitted; submit has already flushed it.
- [ ] A failure logs and leaves the attempt dirty; the live sitting is unaffected, because the
      screen reads Redis.
- [ ] Tests: an upsert twice leaves one row with the later values; an attempt with no changes
      writes nothing; a submitted attempt is skipped.
      **Acceptance:** killing Redis mid-sitting costs at most a minute of answers, not the sitting.

---

## P3-S3 — Ending an attempt

### Task 5: Safe submit, and the sweeper that ends the rest

**Risk:** HIGH · **Reviews:** 2 · **Est:** 0.75–1.25 d
**Exemplar:** `apps/api/src/tests/finalize.service.ts` — the conditional `updateMany`, the
"second call reports the first one's outcome" shape, and reading behind the gate.
**Files:** create `apps/api/src/attempts/submit.service.ts`,
`apps/api/src/attempts/attempt-sweeper.processor.ts`, `apps/api/test/submit.unit.test.ts`;
modify `apps/api/src/queue/queues.ts`, `packages/contracts/src/attempts.ts`.

- [ ] `POST /me/attempts/:id/submit`: flush Redis to Postgres, then flip
      `IN_PROGRESS → SUBMITTED` with `submittedAt` via a conditional `updateMany` — one winner.
      A second submit is a NO-OP that reports the first one's outcome, exactly like finalize.
- [ ] Everything is read BEHIND the gate, so a write landing between the flush and the flip cannot
      be lost or double-counted. Phase 2's finalize made this mistake once; do not repeat it.
- [ ] Enqueue the scoring job (`QUEUE_NAMES.SCORING`, `{ attemptId, testId }`). The request does
      no evaluating; the worker is a no-op until Phase 4 and that is fine.
- [ ] A **repeatable sweeper** finds `IN_PROGRESS` attempts past `endsAt` and submits them through
      the same path — a closed tab must not leave an attempt open forever. It submits what Redis
      holds; a student who never answered submits an empty paper, which is a real result.
- [ ] The sweeper is idempotent and safe to run concurrently with a student's own submit: the
      conditional update means one of them wins and the other reports it.
- [ ] Tests: a second submit changes nothing and returns the first `submittedAt`; a sweep submits
      an expired attempt and leaves an in-time one alone; a sweep racing a manual submit produces
      one submission; the scoring job is enqueued exactly once.
      **Acceptance:** every attempt ends exactly once, whoever ends it.

### Task 6: Before the exam — the test list and the instructions screen

**Risk:** normal · **Reviews:** 1 · **Est:** 0.75 d
**Exemplar:** `apps/admin/src/routes/tests.tsx` (a list screen); `apps/test/src/routes/dashboard.tsx`
and `apps/test/src/components/pre-test-prompt.tsx` (this SPA's shell and its Alert pattern).
**Files:** create `apps/test/src/routes/tests.tsx`, `apps/test/src/routes/test-instructions.tsx`;
modify `apps/test/src/App.tsx`, `apps/test/src/lib/constants.ts`.
**Read first:** the `ui-conventions` skill, and `docs/02` §5.

- [ ] The student's tests, from `GET /me/catalog`: card-based, tabs for **Active / Upcoming /
      Missed / Completed**, each card carrying name, window, duration and what to do next
      (Start test / Resume / Expired).
- [ ] A **slim system check** before the instructions (`docs/02` §5 keeps a cut-down version of
      ThinkExam's four-step check): the browser is supported, the session is live, and the API is
      reachable. Three checks with a plain outcome, not a wizard — it exists so a student learns
      here rather than mid-exam.
- [ ] The instructions screen: the palette legend, the language selector (from the config's
      `languages`), a declaration checkbox, and "I am ready to begin" — which is what starts the
      attempt. `preTestReady` is prompted here if it is missing (`PreTestPrompt` exists).
- [ ] Anything the student cannot infer goes in an `Alert`, never muted prose.
- [ ] Tests: none beyond what the pure helpers earn — `apps/test` has no DOM harness, so say what
      to verify on screen. A tab-bucketing helper (which bucket a catalog row falls in, by the
      institute clock) is pure and DOES earn one, in `packages/contracts`.
      **Acceptance:** a student finds the test they can sit, reads what they are about to do, picks
      a language, and begins.

---

## P3-S4 — The exam screen

### Task 7: The CBT exam screen

**Risk:** HIGH · **Reviews:** 2 · **Est:** 1.5–2 d
**Exemplar:** `docs/02` §5 and §14 for what it must look like; `packages/ui/src/index.ts` for the
inventory before anything new is written.
**Files:** create `apps/test/src/routes/exam.tsx`, `apps/test/src/components/exam/*` (palette,
section tabs, question body, bottom bar, timer), `apps/test/src/lib/use-attempt-state.ts`;
possibly `packages/ui` if a piece is genuinely design and not domain.
**Read first:** the `ui-conventions` skill. This screen is the one students judge us on.

- [ ] Full-screen, replicating the government CBT layout: section tabs, countdown, per-question
      type and marks, the question body (text, images, `$LaTeX$`), radio options, the right rail
      with status counters and the **questions palette**, and the bottom bar — **Mark for Review &
      Next / Clear Response / Save & Next** — plus Submit.
- [ ] The countdown counts to the server's `endsAt` and NEVER to a duration the client computed.
      Reloading the page recovers the same remaining time, because it comes off the attempt.
- [ ] Per-question **"View In"** language, from the languages that question actually has; a DUAL
      config renders both with no toggle.
- [ ] Local state is the source of truth for the screen; a batch autosaves every ~25s and on
      section change. A failed save retries and warns without losing what is on screen.
- [ ] `SECTIONAL_LOCKED` closes a section when its clock ends and moves on; `COMPOSITE_FREE` is one
      clock with free navigation. The difference is read from the config — **one screen, not two.**
- [ ] Submit confirms, naming what is unanswered and marked. Auto-submit at zero needs no confirm.
- [ ] Tests: the pure parts earn them — remaining-time from `endsAt`, palette counters from the
      state map, which section is open under a sectional clock. The screen itself is a manual check;
      say exactly what to click.
      **Acceptance:** a student sits a full sectional-timed bilingual test start to finish without
      losing an answer, and the screen matches what they see in the real exam hall.

### Task 8: Integration / milestone

**Risk:** — · **Reviews:** 1 · **Est:** 0.5–1 d

- [ ] End-to-end through the fakes, the way `apps/api/test/test-builder.unit.test.ts` walks Phase 2:
      catalog → start → answer → autosave → flush → submit → the scoring job enqueued. It is the
      only place the attempt services meet.
- [ ] Confirm the invariants above still hold, by test where they can be and by grep where they
      cannot: no Postgres write on the answer path, no answer key in any student payload, the
      client never computing a deadline.
- [ ] Full gates green from a clean checkout; `pnpm db:check` clean. Grep for dead ends — every
      endpoint reachable from the typed client, every client method with a caller.
- [ ] One commit: `chore(attempts): phase-3 test engine end-to-end green`.
      **Acceptance:** the Phase-3 milestone is demonstrable on screen, and the hot path is off
      Postgres exactly as the scaling rules require.

---

## Session prompts

### P3-S1

```
Run Phase-3 Session S1 — the attempt, server-side. Execute T1, T2 from docs/superpowers/plans/2026-08-24-phase3-test-engine.md.
Binding: CLAUDE.md, task-constraints.md, WORKFLOW.md, prisma/schema.prisma. Model: opus. Lean loop.
Exemplar: apps/api/src/tests/finalize.service.ts (conditional-update winner), apps/api/src/me/me.controller.ts (STUDENT actor).
- T1 (HIGH,2): attempt lifecycle — start/resume, server-computed endsAt, seed AttemptQuestion from the frozen paper, maxRetakes, idempotent second start.
- T2 (HIGH,2): GET /me/catalog over the existing resolver, and the attempt's paper — shuffled per shuffleSeed, localized, and carrying NO answer key.
Intent check before each. One commit per task.
```

### P3-S2

```
Run Phase-3 Session S2 — live state. Execute T3, T4. Binding + lean loop + opus. HIGH STAKES on T3 — 2 reviews.
- T3 (HIGH,2): Redis attempt state + the autosave batch endpoint. Pure merge rules in attempt-state.ts with a truth-table test; keys in redisKeys, never inline; a named grace window past endsAt.
- T4 (normal,1): the repeatable flusher, Redis -> AttemptQuestion, idempotent and skipping submitted attempts.
Intent check before each. One commit per task.
```

### P3-S3

```
Run Phase-3 Session S3 — ending an attempt. Execute T5, T6. Binding + lean loop + opus. HIGH STAKES on T5 — 2 reviews.
- T5 (HIGH,2): safe submit via a conditional updateMany (one winner, second call reports the first), everything read behind the gate, scoring job enqueued once; plus the repeatable sweeper for attempts past endsAt.
- T6 (normal,1): the student's test list (Active/Upcoming/Missed/Completed) and the instructions screen. Invoke ui-conventions first.
Intent check before each. One commit per task.
```

### P3-S4

```
Run Phase-3 Session S4 — the exam screen. Execute T7, T8. Binding + lean loop + opus. HIGH STAKES on T7 — 2 reviews.
- T7 (HIGH,2): the CBT screen — section tabs, countdown to the server's endsAt, palette + counters, per-question language, Save & Next / Mark for Review / Clear Response, autosave every ~25s, submit. COMPOSITE_FREE and SECTIONAL_LOCKED are one screen read from config. Invoke ui-conventions first.
- T8 (—,1): integration — catalog -> start -> answer -> flush -> submit, invariants confirmed, gates + db:check green.
Intent check first.
```

## What Phase 3 deliberately leaves to Phase 4

Scoring (marks and negative marking in a BullMQ worker), the scored fields on `Attempt`, the
Score Card, the Solution Report, and the live Redis leaderboard for rank and percentile. Phase 3
captures every data point those need — option chosen, state, and time per question — so none of it
requires re-instrumenting.

And two Phase-2 leftovers that belong to whoever touches them next: the per-attempt **GENERATED**
draw (deferred above), and `StudentSeriesUnlock` writes, which are baked into the cached catalog
payload and still emit no `ACCESS_CATALOG_CHANGED`.
