# IACE mock tests — domain rules

The rules a service enforces, an ordering guarantees, or a reason explains. Everything a column, a
type or a foreign key already enforces lives in `prisma/schema.prisma` and is not repeated here.

Stack, scaling and deployment are `docs/01-architecture.md`. Module boundaries, table ownership and
the event catalog are `docs/03-conventions.md`.

---

## 1. What the feature has to fix

ThinkExam is the reference, not the target. Four of its failures shape the rules below.

- **Admin is slow and heavy.** A snappy admin is a requirement, not a nicety.
- **Import is brittle.** Real uploads landed "Total: 321 | Accepted: 5 | Error: 316". A forgiving
  importer is core, not a convenience.
- **Rank and result are manual.** Generate Rank and Regenerate Result are separate buttons, and even
  the automatic setting snapshots a pool, so ranks go stale. Ranking here is always live and there
  is no button.
- **Creation is a rigid wizard** with clunky question mapping. Creation here is config-driven.

Discarded outright, and the model blocks none of them: certificates, typing and essay evaluation,
open-book whitelisting, bio-break scheduling, live proctoring, groups and batches, access codes,
shareable test links, and a nested category tree.

## 2. The catalog and the blueprint

The stage is the level everything hangs off: a base config, a series and a test all point at one. A
`BaseConfig` is a stage's blueprint, and a test **inherits** its shape and never overrides it —
there is no per-test duration, marks or timing. The way to change a shape is to clone it.

- **A taxonomy key cannot change once anything carries it.** A rename of `Exam.code` is refused once
  a student's enrolments hold it, and of `ExamStage.stageKey` once a base config hangs off it. Both
  are free text with no foreign key behind them, so the rename would detach every holder silently
  and report nothing changed. Create a second row instead.
- **A `CATALOG_ONLY` stage carries no paper.** It is listed so the journey reads whole; a config
  pointed at one is refused, because nobody sits it here.
- Marks, negative marks, timing and merit/qualifying are **per section**; one paper may mix them.
  Language is not: a paper renders in one `LanguageMode` throughout.
- The shape rules are checked in the service before the database's deferred triggers see them, so an
  admin gets a field error rather than a raw exception at commit. A `SECTIONAL_LOCKED` paper gives
  every section its own clock and the paper's duration must be their sum. A `SESSION_MODULE_LOCKED`
  paper has at least one `BaseConfigModule`, and no other timer template may have any. Two sections
  never share a position.
- `BaseConfigSection.patternNote` is the exam-pattern workbook's own words. Reference only — no draw
  reads it.
- A config **locks when the first sitting starts** on a test built from it, not when a test is
  finalized. Once locked, only its name, `isDefault` and `isActive` still move; everything else is
  the shape a frozen paper was drawn against. `clonedFromId` is the lineage, and promoting a clone
  means clearing `isDefault` on the original it replaces — a stage holds exactly one default.
- A locked config is never deleted, nor is one that tests inherit from. Retire it: it keeps its
  history and is simply no longer offered.

## 3. Building a test

Setup, then paper, then offer. There is no certificate step.

- `RANKED` forces `FIXED`. A rank only means something if the cohort sat the same paper.
- A `GENERATED` test needs enough papers to be worth drawing; too few and a cohort is back to
  sitting one, which `FIXED` already does better. A `FIXED` test is held at one paper rather than
  refused when something asks for more.
- Scope decides what is in play, and building, drawing, reading, the duration, the question count
  and the marks are all over the scoped sections alone. `FULL` names no part of the paper; `MODULE`
  and `SECTIONAL` must each name theirs, or there is nothing to build a paper from.
- **What a section draws FROM is per section** — its topics, its tags, and optionally a count per
  difficulty. An absent difficulty mix is not "no mix": it is the section drawing across every
  difficulty, so one optional field carries both modes and there is no toggle to keep in step. Absent
  topics mean the whole subject. **There is no test-wide difficulty default.**
- A `FIXED` paper is **picked by hand** from the pool its section's own spec describes. The draw only
  ever ADDS, topping a hand-picked section up to its count; it never withdraws a choice.
- **A hand-pick is capped per difficulty bucket, not only per section.** Once a section already holds
  as many of one difficulty as its mix allows, the next pick of that difficulty is refused and the
  admin is told to take one off first — otherwise the draw could only ever top up a section the hand
  had already made impossible to balance.
- Only an ACTIVE question carrying a current version is drawable, because a paper pins a version.
- Finalize freezes rows that already exist. A `FIXED` paper must hold every section at its exact
  count or the freeze rolls back naming the shortfall — a paper that is not whole leaves the test
  unlocked. A `GENERATED` test draws its `Test.variantCount` papers here, before the freeze, so no
  sitting ever runs a pool query.
- Finalize is a conditional update on the test's version. Two finalizes cannot both win, and a
  request that lost writes nothing.
- Finalize increments `Question.fixedUseCount` for every question it served. Thawing decrements it,
  or a refreeze would count twice.
- Offering a test needs a frozen paper **and** a series: a test reaches a student only through one.
- Editing a finalized test **thaws** its paper unless the edit could not change what the paper holds
  — a rename and a re-skin cannot. Once the test has been **sat**, only its title moves.
- A sat test is never deleted, and the series cannot drop it from its own side either — it is part
  of the record of everyone who sat it, wherever it was offered. Retire it; it keeps its results.

## 4. Lock on first attempt

The first sitting freezes both the paper and the blueprint it came from.

- The **only** permitted post-start change is moving a `PaperQuestion` to `DROPPED` or `BONUS`, and
  it is refused on a paper that is not frozen.
- It moves the question across **every variant** of the test, not one row, and enqueues a re-score
  for every ended sitting that served it.
- `DROPPED` pays its marks to everyone who attempted it and takes back the negative; a student who
  left it alone gets zero. `BONUS` pays the whole cohort.
- `isCorrect` stays the answer key's verdict either way. A drop or a bonus moves the marks, never the
  verdict.

## 5. Access

Reach is to a **series**, never a test. There are no groups, no batches, no access codes and no
shareable link, and the only per-student row in the model is a grant — which is why this scales to a
public rollout unchanged.

- `TestSeries.isEnabled` gates every path. A series nobody switched on reaches nobody.
- **The kind decides who reaches it.** `FREE` reaches every student. `STANDARD` reaches a student
  whose current branch is on the series' `branchIds` and whose enrolled courses include the course of
  the series' stage. `PROGRAM` reaches only students carrying its program code. `EVENT` reaches only
  the candidates on its `Event`.
- A `StudentGrant` overrides every kind. It does not override the enable switch.
- **The branch gate is `STANDARD`'s alone.** A student with no branch is still reached by a free
  series, a program, an event and a grant.
- **Four CHECK constraints hold a series to its kind**, and they are CHECKs precisely because Prisma
  has no syntax for any of them: only a STANDARD series may name branches; only a FREE series may
  span no stage; a series is PROGRAM exactly when it carries a program code; a series is EVENT
  exactly when it carries an event. The last two are equivalences, so neither the kind without the
  column nor the column without the kind can be written.
- **A retired branch takes no new students.** Deactivating one is a service check, not a schema
  constraint: nobody new may be placed in it and nobody may be transferred into it, while the
  students already there keep the branch and everything it reaches.
- A series is reached or it is not: no unlock, no prerequisite, no queue, nothing to ask for.
- `Student.isTestBlocked` leaves the whole catalog readable and starts nothing.
- `TestSeries.sequentialTests` orders the tests INSIDE a series: the first not yet finished is open
  and everything after it waits. It counts submitted and evaluated sittings and is read fresh on
  every catalog read, so submitting one opens the next with nothing having to bust a key.
- `TestSeries.progressive` is a difficulty ramp, not an order. The two move independently.
- **One function answers all of it** (`AccessResolverService`), and both callers read that one
  answer: the student's catalog and the attempt-start guard, so the two cannot disagree.
  `assertCanStart` refuses a sitting; `assertReachable` still opens the test to read about.
- The resolved catalog is cached under an epoch key, but a block, a deactivation or a deletion is
  re-read live at the start gate — an authorization answer must bite now, not when an entry expires.
- A `Notification` on assignment carries the series as its deep link.

## 6. Scheduling

Scheduling belongs to the **test**, and a series has no availability of its own.

- `Test.opensAt` is one instant for the whole institute. `Test.lateEntrySec` counts **from that
  opening** and is what shuts entry. `Test.extraTimeSec` is added to the duration once, where the
  server computes the deadline — an allowance rather than a separate flow, which is where extra time
  for a candidate who needs it folds in.
- `TestProgramUnlock` staggers one test's opening for one program. A student in two programs takes
  the **earliest**, so the slower cohort never holds them back.
- Late entry is still counted from the test's **own** opening, never the program-shifted one: a
  program cohort gets a longer window, not a shifted one.
- A test in no series is scheduled by nothing and shut by nothing.
- `canStart` is derived from the clock on **every read** and never stored, so a test opens on time
  with nothing having to bust a cache key.
- Late entry blocks **starting** a test, never seeing one, and a refusal names which fact refused it:
  not opened yet, entry closed, or no access at all.

## 7. The sitting

- The server owns `startedAt` and `endsAt`; the client clock only counts down to it. The deadline is
  computed once at start and never recomputed.
- **Resume is not a start.** A live sitting is re-entered without asking the start gate again.
  `Test.maxRetakes` caps separate sittings and null is unlimited; nothing counts or caps re-entries
  into one. Two racing starts resolve to one sitting.
- `Attempt.shuffleSeed` decides which of a generated test's papers this sitting gets **and** the
  order the student sees. Sections keep the config's order; questions shuffle within a section.
- The whole served paper is written as `AttemptQuestion` rows at start, not only what the student
  touches, so scoring reads its marks from the paper row it already has.
- `Attempt.isGraded` is true only for the **first** sitting of a `RANKED` test. A practice sitting
  and a retake never enter a cohort.
- `SINGLE` serves the one language picked, narrowed to what the config actually offers; `DUAL` serves
  every language it offers and there is nothing to toggle.
- **Live state lives in Redis, and the key existing is what "this sitting is open" means.** Autosave
  batches what changed roughly every 25 seconds and the server merges it. A save that finds no key
  falls back to Postgres, which refuses anything not in progress — so a save after a submit cannot
  be accepted. A save is still taken up to 30 seconds past the deadline: a slow network is not a
  cheat.
- **Submit's order is the design.** Answers are written before the sitting is claimed, so a write
  that throws leaves it open with its state intact; the claim and the scoring request commit
  together, so no crash strands an attempt nobody scores; the live state is taken last, so nothing
  scores a half-written paper. A sitting nobody ended is ended by the sweeper.
- The pre-test gate is minimal — mother's name, father's name, date of birth. It **prompts**, and
  `profileCompleted` only drives a nudge. Neither blocks a sitting.
- The in-exam screen replicates the government CBT faithfully; it is the one thing students expect to
  match. Everything around it is this repo's own design system.

## 8. Results, ranking and solutions

- **Ranking is always live**, from a Redis sorted set. There is no generate and no regenerate step.
- A sorted-set member holds one number and a rank is two facts, so both are packed into it: marks
  scaled past every possible time, plus a time term counted down. More marks always outranks fewer,
  and at equal marks less time wins. An unfinished sitting reads as the slowest there is.
- Percentile counts a tie as half. A field of one is its own top — reporting the median of a field of
  one reads as a failure.
- Marks are durable and a rank is a cache, so a Redis that is down must not fail the scoring. The
  rank and percentile on the attempt are snapshots; the live figures are read from Redis.
- **The answer key is a second read past one gate, never a join,** so a refusal never held it. A
  practice test opens solutions immediately, and so does a test no series arranged — there is no
  cohort it could spoil. A ranked test offered in a series waits until entry has shut everywhere
  **and** the last sitting that could have started has ended. A scheduled test nobody capped entry on
  never opens them, and the student is told so without being promised a date the gate cannot keep.
- Answer-level detail is captured from day one — option chosen, verdict, marked-for-review state, and
  time per question and per section — so analytics derive later without re-instrumenting.
- `PerformanceShare` is the only unauthenticated door onto a report: a random token rather than a
  walkable id, revocable and expirable.

## 9. Rollups

Every aggregate stores **sums and counts, never averages**, so a fold is incremental and a retry is
cheap; averages are derived on read. `ProcessedRollup` is not analytics — it is the exactly-once
guard, so a redelivered evaluation cannot double-count an attempt into any of the others.
`discrimination` is **batch-only**: it compares a top group against a bottom group and cannot be
maintained one attempt at a time. Practice sittings feed `StudentSubjectStat`, which is keyed by
evaluation mode so practice never pollutes ranked, and never feed a cohort rollup.

What each is for: `StudentStat` backs the dashboard header; `StudentSubjectStat` the subject report,
which is where a student is weak; `TestStat` the cohort comparison; `TestSectionStat` section-level
comparison and time utilisation; `TestQuestionStat` classical item analysis — difficulty index,
discrimination and distractor counts — for fixed papers only.

## 10. Render modes and skins

There is **one** exam engine: one clock, one paper, one state machine, one scoring path. A per-exam
theme gallery is exactly what this refused. Two independent axes sit above it, and both are
presentation.

- **`TestUi` is how the student ANSWERS.** OMR bubbles the same paper rather than picking a radio
  option — it is an input affordance and nothing else. Nothing about an OMR sitting is clocked,
  navigated, drawn or scored differently.
- **`ExamTemplate` is where things SIT** — timer position and format, palette side, section switching
  and the watermark. All of it is resolved through one shared config, so the admin's preview cannot
  describe a screen the student does not get. A test copies the skin from its config at creation: a
  sat paper must not re-skin because the config moved. A skin nothing is registered for falls back
  rather than leaving a candidate on a blank page.
- Every IACE format shares the CBT screen. Their differences are **config, not template**: sectional
  timing on or off and locked versus free switching, an optional on-screen calculator, section and
  question counts, and marking.

## 11. The question bank

`Question` is the identity and `QuestionVersion` is the content. The split is what lets a paper or a
sitting pin exactly what it served while the bank carries on moving underneath.

- **A save that changes nothing writes no version.** Content, options and answer key are
  fingerprinted together, and a save matching the fingerprint keeps the version already current.
- **A draft is rewritten in place, and everything else is appended.** While a question is a DRAFT
  and no paper or sitting holds its current version, an edit rewrites that one row — version 1 of a
  question nobody has drawn stays version 1 however often it is saved. Otherwise the edit inserts a
  new immutable version and repoints `currentVersionId`, so what a paper pinned never moves under
  it.
- **Being depended on is what freezes a question, not being published.** Nothing a `PaperQuestion`,
  `AttemptQuestion` or `TestQuestionStat` references may be returned to DRAFT or deleted; the rule
  counts those three tables before it allows the move, so it refuses before a foreign key does.
- **Subject and topic settle when the question leaves the draft.** Taxonomy is what a section draws
  on, so moving it afterwards would change what a finalized paper was built from. Returning the
  question to draft is the only way to move it, and the freeze above refuses that once anything uses
  it.
- **Option ids carry over by position.** A sitting stores the id it was shown, so a position that
  already had an id keeps it and only a genuinely new position gets a new one — editing an option's
  wording can never orphan an answer.
- **A topic must sit under the question's own subject.** The question carries both ids and no
  foreign key can relate them, so the check is a shared rule in
  `packages/contracts/src/question-rules.ts` — the same one for the editor and the importer.

## 12. Question import

**One row is one question, with a column per language.** That is the deliberate inversion of
ThinkExam's flat 51-column sheet, whose 32 mostly-empty option columns, free-text taxonomy and
letter-based answer key are why real uploads were rejected wholesale.

- The correct answer is an option **index**, converted to a stable option id on ingest, so a later
  shuffle or edit never breaks the key.
- Every cell is plain text and arrives exactly as typed, so `x < 5` and `A & B` are safe. Formatting,
  tables, images and equations are **not** read from a sheet — a tag typed into a cell shows as the
  tag. Rich content is added by opening the question in the bank afterwards.
- **Nothing is created by an import.** A subject or topic matching nothing in the bank is reported
  against its line, never quietly invented; the dropdowns cascade, so the topics offered on a row are
  the ones under that row's subject.
- English is required. Another language is all-or-nothing — a question written in one needs both its
  stem and all of its options in it, because a half-translated paper cannot be sat in that language.
- **Marks are not on the sheet.** What a question is worth is decided by the section of the test it
  is drawn into, not by the bank.
- **Preview, then commit.** Every row's outcome is shown first; a row with problems is listed with
  its reason and skipped; a stem already in the bank, or earlier in the same file, is a **duplicate**
  and is skipped rather than reported as an error — re-uploading a sheet with new questions on the
  end is normal. Duplicates are found by normalised stem hash.
- Every imported question carries the `imported` tag, so one filter finds what an upload brought in.
- An upload is bounded so it stays a single synchronous request.

Two intake paths, and they are not interchangeable: this sheet for bulk text MCQs, and the rich
manual editor for anything carrying an image or an equation.

## 13. A worked blueprint — SSC CGL Tier 1

The official patterns are seeded (`prisma/seed.sql` and `prisma/seed.catalog.sql`); IACE validates
them as the domain expert. SSC CGL Tier 1 is the reference shape: four sections of 25 single-answer
MCQs, +2 correct and −0.5 wrong, 100 questions for 200 marks in one 60-minute sitting, one composite
clock with free movement between sections, no calculator, order and options shuffled per student,
and both languages rendered together because the real paper is bilingual and the candidate does not
choose one.

Two rules it demonstrates. **A tier is its own stage with its own config**, never a variant of
another — Tier 2 has a different structure, different negative marking and sectional timing, so it
is a separate blueprint rather than a setting on this one. And **the totals are a display cache**: a
config's question count and total marks are the sums of its sections, and a seed test asserts they
agree.
