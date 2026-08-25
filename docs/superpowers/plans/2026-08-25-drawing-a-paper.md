# Drawing a paper: topics, difficulty mix, and papers per student — implementation plan

> **For agentic workers:** T2 is a migration and T4 is the attempt path — both high-stakes. T5 is
> an accessibility-sensitive control. Lean loop per `docs/superpowers/WORKFLOW.md`; invoke the
> `ui-conventions` skill before any screen work.

**Goal:** An admin says what a section should be drawn FROM — which topics, and in what mix of
difficulty — and the bank is checked against that before anything is committed. A generated test
finally produces papers a student can sit.

## What is there today

- `Test.questionPoolFilter` (`{ subjectIds, topicIds, difficulties, tags }`) is applied in
  `draw-engine.ts:158` and **no screen has ever exposed it**. It is test-wide and a flat include
  list: there is no way to say "seven hard ones from Percentages".
- **GENERATED is a stub.** `attempt-rules.ts:20` refuses it outright — "draws a fresh paper for
  each student, which this version cannot serve yet" — while the builder offers the binding and
  lets a test be built that nobody can open. `AttemptQuestion.paperQuestionId` is already nullable,
  so the schema was built expecting this and the code never arrived.
- The draw fills a section from one ordered pool. Difficulty is a filter, never a proportion.

## The design

**The spec is per section, on the test.** `questionPoolFilter` is reshaped; no migration, it is
already `Json?`, and nothing reads the old shape on screen.

```ts
{ sections: { [baseConfigSectionId]: { topicIds?: string[]; mix?: DifficultyMix } } }
```

**`mix` absent IS "any difficulty".** One optional field carries both modes rather than a toggle
that has to be kept in step with it. Blank `topicIds` is the whole subject, the same idea.
The default the UI proposes is a code-owned `DEFAULT_DIFFICULTY_MIX` of 30/40/30 — not the
blueprint's, which would be a second place to look and a locked one.

<counts-not-shares>

**A mix is COUNTS, not percentages.** The section already knows how many questions it holds, so a
split says `7 low, 11 medium, 7 high` of 25 and adds up by construction. There is no rounding
rule, no tiebreak, and no way for two draws from one spec to produce papers of different lengths.

Percentages were tried and dropped: 30/40/30 of 25 is 7.5/10/7.5, and every way of resolving that
was either wrong or surprising — plain largest remainder gives 8/10/7 because MEDIUM's remainder is
zero, and "give the spare to the middle" draws a medium question for a 50/0/50 paper that asked for
none. The rule that survived both was correct and nobody would have been able to predict it.

The 30/40/30 shares survive in ONE place: `defaultMixFor(questionCount)`, which produces the split
the form starts from. It is never stored and never read back, so a default that lands a question
either side of the ideal costs nothing.

The one rule the schema cannot hold is that the three add up to the section's count — the schema
never sees the section. `mixIssue(mix, section)` is that rule, beside the topic-belongs-to-subject
check no FK can make either.

</counts-not-shares>

**One feasibility rule, three places.** `paperFeasibility(spec, sections, poolCounts)` is pure, so
it needs no database:

| When                        | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| Live, as the spec is edited | `7 needed · 3 available` beside the mix, before anything is committed    |
| FIXED, at the draw          | Refuses, nothing drawn — today's shortfall, one bucket finer             |
| GENERATED, at the offer     | There is no draw to hang it on, and a student clicking Start is too late |

**A refusal carries its own way out.** Naming the thin bucket is not enough if the admin cannot act
on it, so the alert offers both: adjust that section's proportions, or drop its mix and draw across
the whole eligible pool.

**A generated test is a bank of variants, drawn when it is offered.** Not a live draw per attempt:
the opening minute of a live test is the one path `CLAUDE.md` says to keep off Postgres, and a pool
query plus a draw per student is exactly what it warns about. Each variant is a fixed paper, so
item analysis and the leaderboard keep working unchanged, and twenty papers can be audited where
two thousand cannot. RANKED still refuses GENERATED — twenty papers is not one paper, and a rank
across them would not mean anything.

## Tasks

### Task 1: The spec and the rule that judges it

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** modify `packages/contracts/src/tests.ts`; create
`apps/api/src/tests/paper-feasibility.ts`; extend `packages/contracts/test/tests.test.ts`; create
`apps/api/test/paper-feasibility.unit.test.ts`.

- [x] Reshape `questionPoolFilterSchema` into the per-section map. `mix` optional; its three
      values are whole counts, never shares.
- [x] `defaultMixFor(questionCount)` — the split the form starts from, near 30/40/30, always
      adding up to the count.
- [x] `mixIssue(mix, section)` — the three add up to what the section holds.
- [x] `paperFeasibility(...)` returns one issue per short bucket, naming the section, the
      difficulty, what is needed and what is available. Lives in contracts, not the server: the
      form shows the same numbers live and the two must not disagree.
      **Acceptance:** a default for 25 is 7/11/7 and for 10 is 3/4/3, and every count from 0 to
      60 adds up; a split that does not add up to its section is named with both numbers; a
      section with no mix is judged on its total alone; a thin bucket is reported with both
      numbers.

### Task 2: A paper row knows which variant it belongs to

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `prisma/schema.prisma`; create the migration by hand; modify
`packages/contracts/src/tests.ts`.

- [x] `PaperQuestion.variant Int @default(0)`. A FIXED paper is variant 0 and always will be.
- [x] `@@unique([testId, questionId])` becomes `@@unique([testId, variant, questionId])`, and
      `@@unique([testId, order])` becomes `@@unique([testId, variant, order])` — the same question
      at the same position in two different variants is correct, not a duplicate.
- [x] The two composite-FK uniques (`[id, questionId, questionVersionId]`,
      `[id, baseConfigSectionId]`) are untouched: they target a ROW, which is still unique.
- [x] `Test.variantCount Int @default(1)`, so picking a variant needs no aggregate on the hot path.
      **Acceptance:** `pnpm db:migrate:deploy` from scratch and `pnpm db:check` both pass; an
      existing FIXED paper keeps every row at variant 0 and its uniques still refuse a duplicate
      question within that variant.

### Task 3: The draw fills buckets, not just sections

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `apps/api/src/tests/draw-engine.ts`, `apps/api/src/tests/paper.service.ts`;
extend `apps/api/test/draw-engine.unit.test.ts`, `apps/api/test/paper-service.unit.test.ts`.

- [ ] A section with a mix draws each bucket to its own count; without one it draws as it does
      today. Topics narrow the eligible pool per section rather than test-wide.
- [ ] Hand-picked questions count against their OWN bucket first — pinning three hard ones into a
      seven-hard bucket leaves four to draw, not seven.
- [ ] Feasibility runs before the draw, so a refusal names buckets rather than sections.
      **Acceptance:** a 30/40/30 section draws exactly that split; pins are counted in their
      bucket; a section without a mix is unchanged from today; a thin bucket refuses and writes
      nothing.

### Task 4: A generated test has papers, and a student can sit one

**Risk:** HIGH · **Reviews:** 2 · **Model:** opus
**Files:** modify `apps/api/src/tests/finalize.service.ts`,
`apps/api/src/tests/offering.service.ts`, `apps/api/src/attempts/attempts.service.ts`,
`apps/api/src/attempts/attempt-rules.ts`; extend the matching tests.

- [ ] Offering a GENERATED test runs feasibility, then draws `Test.variantCount` papers, each with
      its own seed, into `PaperQuestion` under its variant number.
- [ ] Attempt start picks `shuffleSeed % variantCount` and reads that variant's rows. No pool
      query, no draw, nothing new on the hot path.
- [ ] `testStartBlocker` stops refusing GENERATED and starts refusing a test with no variants.
      **Acceptance:** two students starting the same generated test can get different papers and
      both can sit them; a generated test whose bank cannot fill a bucket is refused at the offer,
      not at the start; the leaderboard and item analysis still resolve per variant.

### Task 5: A three-way split anyone can drive

**Risk:** normal · **Reviews:** 1 · **Model:** opus
**Files:** create `packages/ui/src/components/ui/ratio-bar.tsx`,
`packages/ui/test/ratio-bar.dom.test.tsx`; modify `packages/ui/src/index.ts`.

- [ ] One stacked bar, two handles, three labelled parts that always total the section's question
      count. Dragging a handle re-splits between the two parts it sits between and never touches
      the third, so the total cannot drift.
- [ ] Each handle is a real `role="slider"` with `aria-valuenow`, `aria-valuetext` and arrow-key
      steps. **A control only a mouse can drive is not finished** — this is the whole risk in the
      task.
- [ ] Design-system tokens only; the three parts are distinguishable without relying on colour
      alone.
      **Acceptance:** dragging and arrow keys produce the same values; the three always total the
      count they were given; a screen reader is told which part a handle governs and what it now
      reads.

### Task 6: The section says what it draws from

**Risk:** normal · **Reviews:** 0 (caveman) · **Model:** opus
**Files:** modify `apps/admin/src/routes/test-builder-paper.tsx`,
`apps/admin/src/components/question-picker.tsx`; create
`apps/admin/src/components/draw-spec.tsx`.

- [ ] Inside each section's accordion, above the bank: the topics it draws from, a switch for
      grouping by difficulty, and the `RatioBar` when it is on.
- [ ] The bar splits the section's own question count, so its three parts ARE the counts and the
      total cannot drift. What the bank holds sits beside each, so a short bucket is visible while
      it is being set rather than after a draw refuses.
- [ ] The refusal alert's two actions work on the section they name.
      **Acceptance:** an admin sets a section to draw from three topics at 30/40/30, sees the
      counts and the availability, and knows the paper will fill before pressing Draw.

## Verify on screen

- The bar reads and drags sensibly at a narrow width, and its labels do not collide.
- A section switched to any-difficulty stops showing bucket counts entirely rather than showing
  zeroes.
