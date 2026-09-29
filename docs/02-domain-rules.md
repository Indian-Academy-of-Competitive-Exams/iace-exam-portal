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
- Before it locks, a config that tests are built on still keeps its **sections and modules**: a
  save rewrites them with new ids, and a test's paper rows, assignments, sectional scope and draw
  spec all name them by id. Clone it to change them.
- A locked config is never deleted, nor is one that tests inherit from. Retire it: it keeps its
  history and is simply no longer offered.

## 3. Building a test

Setup, then paper, then offer. There is no certificate step.

- **A test is one paper, and every sitting is served it.** A rank only means something if the
  cohort sat the same questions, and because the paper is built before anyone sits it, no sitting
  ever runs a pool query.
- Scope decides what is in play, and building, drawing, reading, the duration, the question count
  and the marks are all over the scoped sections alone. `FULL` names no part of the paper; `MODULE`
  and `SECTIONAL` must each name theirs, or there is nothing to build a paper from.
- **What a section draws FROM is per section** — its topics, its tags, and optionally a count per
  difficulty. An absent difficulty mix is not "no mix": it is the section drawing across every
  difficulty, so one optional field carries both modes and there is no toggle to keep in step. Absent
  topics mean the whole subject. **There is no test-wide difficulty default.**
- The paper is **picked by hand** from the pool its section's own spec describes. Filling a section
  draws the rest from that spec, and the draw only ever ADDS, topping a hand-picked section up to
  its count; it never withdraws a choice.
- **A hand-pick is capped per difficulty bucket, not only per section.** Once a section already holds
  as many of one difficulty as its mix allows, the next pick of that difficulty is refused and the
  admin is told to take one off first — otherwise the draw could only ever top up a section the hand
  had already made impossible to balance.
- Any question that is not ARCHIVED and carries a current version is drawable. A paper pins a
  version, so there has to be one; nothing else gates the draw, because a paper is built before its
  questions are finished and what stops an unfinished one reaching students is the offer, which
  refuses while any assignment on the test is unfinalized.
- **Where a test's questions come from is chosen once, by anyone, and then by nobody** — not a
  super admin either: every assignment on the test rests on it. Both sources take a typist and a
  proof-reader per section; a role can pass to somebody new, and the earlier holder stays on the
  record (`replacedAt`) reading but no longer acting. A holder can be taken off only while nothing
  has been done under them — typed, edited, reviewed, commented or finished.
- **A typed (FRAMED) section's paper is its typist's Done**, which also hands it to its
  proof-reader (`handedAt`). One action per section: the typist chooses exactly the section's
  count, inside its difficulty split, and Done is refused while the choice is short — so a reader
  always gets a whole section. The chosen become the section's paper rows; each question left out
  goes to the bank as an ordinary question, or is deleted if the typist says so. Nobody but a super
  admin picks, fills or removes on a FRAMED paper. After Done the typist changes only a question
  the reader sent back to them, and anything new they write goes to the bank, not this paper.
- **A picked (PICKED) section reaches its proof-reader when its owner hands it over**, which is
  refused until the paper holds the section's count. Its typist types nothing: they fix what the
  reader sends back.
- **A test's paper is frozen iff it has been offered**, which is the whole of the rule: `finalizedAt`
  is set by the first offer and never cleared, and there is no separate flag and no unfreezing.
- The offer freezes rows that already exist and draws nothing. The paper must hold every section at
  its exact count or the freeze rolls back naming the shortfall — a paper that is not whole leaves
  the test a draft.
- The offer runs in a transaction that holds the Test row, so two offers take turns and the second
  finds the paper frozen. The Offer step's save carries back the test's version from when it was
  opened; a save made from a draft another save has since overtaken is refused, never merged.
- `finalizedAt` is the watermark that makes a repeated offer idempotent: a retired test offered again
  only changes status, and never re-freezes or re-draws its paper.
- Offering needs a whole paper and every assignment read. The series it reaches a student through is
  not a second condition: a test is created inside one and cannot leave.
- **An offered test's paper no longer moves** — adding, replacing and removing are refused, and so is
  any test edit that could change what the paper holds; a rename and a re-skin cannot, so they are
  allowed. Dropping a question or paying it as a bonus is the one change left. Once the test has been
  **sat**, only its title moves.
- A sat test is never deleted — it is part of the record of everyone who sat it. Retire it; it keeps
  its results.

## 4. Lock on first attempt

The first sitting freezes both the paper and the blueprint it came from.

- The **only** permitted post-start change is moving a `PaperQuestion` to `DROPPED` or `BONUS`, and
  it is refused on a test that has not been offered.
- The move and the test's `paperRevision` commit together, and every sitting is stamped with the
  revision its marks were counted against; the sweeper re-scores each evaluated sitting behind its
  test's, once per revision, so no drop or bonus lands without the marks following it.
- `DROPPED` pays its marks to everyone who attempted it and takes back the negative; a student who
  left it alone gets zero. `BONUS` pays the whole cohort.
- `isCorrect` stays the answer key's verdict either way. A drop or a bonus moves the marks, never the
  verdict.

## 5. Access

Reach is to a **series**, never a test. There are no groups, no batches, no access codes and no
shareable link, and the only per-student row in the model is a grant — which is why this scales to a
public rollout unchanged.

- **A test belongs to exactly one series and is created inside it.** It MOVES between series and is
  never unlinked: the catalog walks series → tests, so a test in no series reaches nobody — a state
  with no valid ending rather than a test waiting to be placed. Once anybody has sat it, it stops
  moving: it is part of the record of everyone who did, in the series they sat it in.
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
- **The student type decides the branch** (`studentBranchBlocker`, the one rule every writer asks —
  the admin create and edit and the roster import). ONLINE sits in the online branch, OFFLINE at a
  centre, and NON-IACE at none: they are outside the institute, and a branch would hand them its
  series. An edit is judged on the pair it leaves, so switching a student to NON-IACE is refused
  unless the same save clears their branch. The admin create and edit PLACE an online student
  naming no branch in the online branch themselves (refused until it exists); the roster import
  does not, and an ONLINE row names the online branch like any other.
- **A retired branch takes no new students.** Deactivating one is a service check, not a schema
  constraint: nobody new may be placed in it and nobody may be transferred into it, while the
  students already there keep the branch and everything it reaches.
- A series is reached or it is not: no unlock, no prerequisite, no queue, nothing to ask for.
- `Student.isTestBlocked` leaves the whole catalog readable and starts nothing.
- `TestSeries.sequentialTests` orders the tests INSIDE a series: the first not yet finished is open
  and everything after it waits. It counts submitted and evaluated sittings and is read fresh on
  every catalog read, so submitting one opens the next with nothing having to bust a key.
- **One function answers all of it** (`AccessResolverService`), and both callers read that one
  answer: the student's catalog and the attempt-start guard, so the two cannot disagree.
  `assertCanStart` refuses a sitting; `reachableTest` still opens the test to read about.
- **Nothing per student is cached.** Every catalog, brief and start reads the student's row, grants,
  event candidacies and sittings live, so a block, a grant or a submit counts on the very next
  request. Only the series side is held, once per API process, and rebuilt when
  `access:catalog:epoch` moves — any series, offered test, blueprint, stage or exam write bumps it — or after 15 minutes.
- A `Notification` on assignment carries the series as its deep link.
- **An import only adds access.** A roster uploaded again merges its courses, exams and programs
  into what each existing student already holds, as the program import appends its code; a blank
  cell takes nothing away. Access is removed on the student's own screen. Branch and student type
  are single values and follow the sheet; a NON-IACE row leaves the branch blank and holds none, and
  one that names a branch is refused.

## 6. Scheduling

Scheduling belongs to the **test**, and a series has no availability of its own.

- `Test.opensAt` is one instant for the whole institute, and nothing shuts a test once it opens: a
  student sits it whenever they reach it.
- `TestProgramUnlock` opens one test **earlier** for one program, never later. A student in two
  programs takes the **earliest**, so the slower cohort never holds them back. The rule spans two
  tables, so `OfferingService` holds it alone: it refuses a program opening later than the test's
  own or on a test with no opening (which is already open), moving the test's opening earlier drops
  every program opening now later than it, and clearing it drops them all.
- **The Offer step saves in one request** (`PUT /admin/tests/:id/offering`): the test's opening, the
  program openings it keeps, and whether it is offered, in one transaction that holds the Test row.
  A refusal anywhere leaves the test exactly as it was. A program opening the admin set is judged
  and refused; one they left alone and the new opening overtook is dropped, as the Offer step warns.
  Offering is the only road to ACTIVE, and retiring is the save with `offered` false.
- **A sitting may begin `START_GRACE_MS` before the opening** — five minutes. A hall does not fill on
  the stroke of the hour, and a student held at the door is a student losing exam time to a queue.
  The grace lives inside `testIsOpen`, which is the ONE predicate everything asks: the catalog's
  `canStart`, the start gate's refusal, and the offering validation below. Two predicates would let
  the student side and the admin side disagree about when a test is open, which is the bug the single
  function exists to prevent.
- **An opening being set lies more than the grace ahead of now**, for the test and for a program
  alike. A time inside the grace is a test that opens the moment it saves — which is what
  `OPENING_HAS_PASSED` exists to refuse — so `OfferingService` refuses it and the Offer step says so
  under the field before Done asks. Only a NEW time is judged: an opening that has since passed
  is history, and saving anything else on the test never asks it again. Blank stays allowed on the
  test's own opening, and opens it as soon as a student reaches it.
- `canStart` is derived from the clock on **every read** and never stored, so a test opens on time
  with nothing having to bust a cache key.
- The opening blocks **starting** a test, never seeing one, and a refusal names which fact refused
  it: not opened yet, or no access at all.

## 7. The sitting

- The server owns `startedAt` and `endsAt`; the client clock only counts down to it. The deadline is
  set once at start, and moves only by the pause credit below.
- **Resume is not a start.** A live sitting is re-entered without asking the start gate again. A
  test may be sat again any number of times, and nothing counts or caps re-entries into one sitting.
  Two racing starts resolve to one sitting.
- **A student answers one sitting at a time, on one tab.** Starting or resuming a sitting hands it to
  the tab that asked, and stands down whichever tab held the student's last one — the same rule
  whether that was another tab, another device, or another test. A save or a submit from a tab that
  no longer holds its sitting is refused, with `SITTING_SET_ASIDE` when the student opened another
  sitting and `SITTING_TAKEN_OVER` when another tab or device holds this same one. Either way the tab
  stops saving and keeps what it had not saved, and sends it if the student continues there. Nothing
  already written is lost, and the sitting it was stood down from stays live and resumable. Known
  limit: that kept queue is resent as it stands, so it can overwrite an answer given on the other
  device since; the fix is a per-question version the server's save checks. A sitting held by nobody, because
  its key was rebuilt from Postgres, is adopted by the first tab back. A reclaim names its attempt
  and never starts a new one: once that sitting has ended, it is refused with `SITTING_ENDED`.
- **A pause is credited, not stopped.** Falling silent longer than the reload grace
  (`PRESENT_GRACE_SEC`) moves the deadline, and every open section's clock, out by the gap — a
  laptop sleeping, a dropped network or a genuine multi-hour pause costs the student nothing. That
  credit is capped per sitting at `PAUSE_CREDIT_CAP_SEC`, the same ceiling `PAUSE_LIMIT_SEC` already
  puts on one pause, so no number of reloads can bank more than the one long pause that limit already
  allows. Past `PAUSE_LIMIT_SEC` of silence the sitting is abandoned, and so is one whose credit is
  spent — the sweeper ends both at their deadline rather than letting a reopened tab hold a sitting
  that can no longer earn a second.
- **Leaving takes the unsent answers with it.** On the web the unsent copy lives in the tab's
  `sessionStorage`, which dies with the tab. So closing or reloading with anything unsent raises the
  browser's own "changes may not be saved" prompt, and leaving anyway sends it all on a `keepalive`
  request that outlives the page. That request cannot refresh an expired token; a reload keeps the
  copy for the next open, a closed tab does not. The mobile app keeps its copy on disk and sends it
  the moment it goes to the background, where the OS may end it.
- **`NavigationPolicy` decides what the palette is for.** Under `FREE` it opens any question in the
  section. Under `FORWARD_ONLY` a question left is closed for good: a seat already passed cannot be
  reopened, Save & Next stops wrapping from the last seat back to the first — a wrap is a move
  backwards — and **marking for review is gone**, because a flag asks for a second look the paper
  will never grant. Two of the five answer states are therefore unreachable, and every legend, tally
  and summary column on such a paper shows three. This is a rule the SCREEN keeps, like the clock:
  the engine holds it once so no skin can forget it, and the server takes answers the same way
  either side of it.
- `Attempt.shuffleSeed` decides the order the student sees, of questions and of their options.
  Sections keep the config's order; questions shuffle within a section. **The order a seed produces
  must never change**: every past sitting's review is derived from it, so a new shuffle or PRNG
  reorders every review already given.
- A sitting keeps its answers on one `AttemptSheet`: a slot per paper row in paper order, seeded
  untouched at start, written whole from Redis by the flusher and again at submit, and marked by the
  scorer in a parallel verdict array. The flusher only reads the live key, and unmarks a sitting
  only where the key still holds what it wrote — so it never makes a save retry, and a pass that
  dies loses no mark. The order a student saw is derived from `shuffleSeed`, never stored.
  **Once anyone sits a test its paper is frozen in the database** — rows may not be added, removed,
  repointed or repriced; only a question's status moves — and so are the options, answer key and
  content of every version it pins. A slot's state is an index into `SLOT_STATES`, which is
  therefore **append-only**: reordering or removing a state rereads every stored sheet. For support
  and ad-hoc SQL, the `AttemptSheetAnswer` view decodes a sheet into one row per slot. A future data
  migration that must touch a sat paper stands the guards down inside its own transaction and
  re-enables them there, as `20260827090000_pattern_note_says_what_it_holds` does for the base
  config's section guards.
- `Attempt.isGraded` marks the **one sitting holding the student's ranked slot** on a test —
  normally the first, and a later one only where a void handed the slot back (§8). Any other
  sitting is a retake: marked, never ranked, and never in a cohort.
- `SINGLE` serves the one language picked, narrowed to what the config actually offers; `DUAL` serves
  every language it offers and there is nothing to toggle.
- **Live state lives in Redis, and the key existing is what "this sitting is open" means.** Autosave
  batches what changed roughly every 25 seconds and the server merges it, answering with the
  revision and the clock rather than the sheet — the screen already holds what it just sent, and
  reads the whole state back only where it starts from nothing. A save that finds no key
  falls back to Postgres, which refuses anything not in progress — so a save after a submit cannot
  be accepted. A save is still taken up to 30 seconds past the deadline: a slow network is not a
  cheat.
- **Submit's order is the design.** The screen's last unsaved answers ride the submit and are
  applied by the save's own rules, so the deadline costs one request, not two. Answers are written
  before the sitting is claimed, so a write that throws leaves it open with its state intact; the live state is taken behind the claim and
  written last, so nothing scores a half-written paper; only then is it queued for scoring. A sitting
  left `SUBMITTED` and unscored is queued again by the sweeper under the same id, and a sitting
  nobody ended is ended by it.
- The pre-test gate is minimal — mother's name, father's name, date of birth. It **prompts**, and
  `profileCompleted` only drives a nudge. Neither blocks a sitting, and neither is stored: both are
  read off the profile (`READINESS_FIELDS`) wherever a student is read.
- The in-exam screen replicates the government CBT faithfully; it is the one thing students expect to
  match. Everything around it is this repo's own design system.
- **Every active test is watched live.** The ops screen exists to verify who is in a hall and to
  reach into a sitting that went wrong. A retake is on the board beside the ranked sittings and
  labelled as one, and the actions themselves (§8) handle either.

## 8. Results, ranking and solutions

- **Ranking is always live**, counted from Postgres. There is no generate, no regenerate and no
  rebuild step.
- A test's cohort is its graded, evaluated, scored sittings, and "N sat" is its size. Rank orders it
  by marks, then time taken, then id: more marks always outranks fewer, at equal marks less time
  wins, and the id parts an exact tie so no two sittings share a place. An unfinished sitting, or
  one with no time recorded, reads as the slowest there is. Time taken is wall time from start to
  submit, so a paused sitting counts its pause: a pauser always loses the tie-break. That is
  consistent with "unfinished ranks slowest" and is deliberate, not an oversight.
- Percentile counts a tie on marks as half, and time does not enter it. A field of one is its own
  top — reporting the median of a field of one reads as a failure.
- **Nothing saves a rank or a percentile.** Scoring writes the marks and the time taken; every rank
  and percentile is the sitting's standing at the moment it is read, so a first sitter's percentile
  moves as others sit.
- **The answer key is a second read past one gate, never a join,** so a refusal never held it. The
  gate is the student's own sitting: its solutions open as soon as it is evaluated. A test never
  shuts, so there is no moment when everyone has sat it to wait for.
- **An early submitter holding the key while the hall still sits is accepted, not a gap to close.**
  On a batch mock the first student marked can pass the key to somebody on question 34, and no
  waiting gate is coming back to stop it — the one that existed went with the scheduling chain in
  `08d9d51`. This platform exists to put as many papers in front of a student as possible so the
  habit of working under a clock forms; it is not proctoring software, and a student who copies has
  thrown away the only thing he came for. Weigh a proposal to gate the key against that, not against
  the leak on its own.
- Answer-level detail is captured from day one — option chosen, verdict, marked-for-review state, and
  time per question and per section — so analytics derive later without re-instrumenting.
- **A void is an archive, never a delete.** The support console stands a sitting down — `VOIDED`,
  with who did it and why — and it then counts nowhere: every fold, board and cohort read selects
  `EVALUATED`, which the status no longer is. Voiding one already marked asks for the test's cohort
  rollup and that student's own rollup to be built again; ranks and percentiles need nothing, since
  the next count leaves it out.
- **The ranked slot is spent unless it is handed back.** `isGraded` stays on the voided sitting, so
  a re-sit is a retake; voiding with "Give the ranked attempt back" clears it, and the next sitting
  ranks because no sitting holds the slot. Either way at most one sitting per (student, test) is
  graded.

## 9. Rollups

Every aggregate stores **sums and counts, never averages**; averages are derived on read.

**A rollup holds only what a read cannot count cheaply.** A test's spread — its mean, highest,
lowest and curve — is one grouped read of its ranked sittings, and its topper is the board's rank 1,
one probe of the ranking index; both are counted live like rank, so `TestStat` keeps only the count
and the time a series of tests is read by without a scan each.

**The two halves are counted differently, because their writes land differently.** A student's own
aggregates touch one row per student, so five thousand concurrent scorers contend on none of them:
`StudentStat` and `StudentSubjectStat` are written **inside the scoring transaction**, gated on the
same claim that marks the sitting evaluated. They commit with the
marks, and a retry cannot count them twice because the claim has already been taken.

The cohort's aggregates all land on one row per test, so writing them per submit would serialise a
hall on it. They are **recounted, never folded**: a periodic pass finds the tests something has
landed on since they were last counted and writes the answer outright. A recount needs no ledger —
running it twice writes the same numbers — which is why no exactly-once ledger table exists, and
no delta has to be reversed. `TestStat` and `TestSectionStat` come from `Attempt` alone, off the marks and the
packed `sectionScores`, and run on the short clock; `TestQuestionStat` needs every sheet and runs
on a slower one.

**Item discrimination is not computed.** It compares a top scoring group against a bottom one, which
an incremental fold could not do an attempt at a time, and the column sat unwritten from the day it
was added; it was dropped with the fold. The item pass now replays the whole cohort in one go, so
nothing stands in the way of computing it — that is a feature to ask for, not a gap left behind.

The pass's watermark is `Attempt.updatedAt`, not `evaluatedAt`. The two things that move marks
already counted — a dropped question re-scoring every sitting, and a void — both leave `evaluatedAt`
exactly where it was, so a pass keyed on it would see neither. It also looks back past its own
watermark by a short lag, because a sitting can commit after a pass has read. On the student side
the watermark is when a rebuild last read, and only a sitting that moved after its first evaluation
(`updatedAt` past `evaluatedAt`: a re-score, or a void) counts as drift: the first evaluation
commits its fold with its marks, so treating it as drift would replay every student on every pass.

Every evaluated sitting feeds `StudentStat` and `StudentSubjectStat`, retakes included, because a
retake is still work a student did; `StudentStat.retakeCount` counts them, and its score sum leaves
them out. No rollup holds a percentile: a student's average and best are counted live from their
graded sittings' standings (§8), because a percentile moves as others sit. Only the graded sitting
feeds `TestStat`, `TestSectionStat` and `TestQuestionStat`, so a cohort is one row per student.
`StudentSubjectStat` is keyed by student, subject and scope, and a subject's overall figure is the
sum of its scopes, taken on read.

What each is for: `StudentStat` backs the dashboard header; `StudentSubjectStat` the subject report,
which is where a student is weak; `TestStat` the cohort comparison; `TestSectionStat` section-level
comparison and time utilisation; `TestQuestionStat` item analysis — the difficulty index and
the distractor counts.

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
  timing on or off and locked versus free switching, free or forward-only navigation (§7), an
  optional on-screen calculator, section and question counts, and marking.

## 11. The question bank

`Question` is the identity and `QuestionVersion` is the content. The split is what lets a paper or a
sitting pin exactly what it served while the bank carries on moving underneath.

**`Question.difficulty` is a BANK tag, for drawing a paper and nothing else.** It is a setter's
judgement against one exam's standard, and that standard differs per exam — a question that is LOW
for SSC CGL can be MEDIUM for SI/PC, and no mapping between them exists or is going to. So it fills
a section's difficulty mix and it is read on the authoring screens; it is never shown to a student
and nothing is banded, averaged or ranked by it. Where a screen wants to say how hard a question
was, it says what share of the field got it right, which is measured inside that paper's own cohort
and needs no mapping at all.

- **A save that changes nothing writes no version.** Content, options and answer key are
  fingerprinted together, and a save matching the fingerprint keeps the version already current.
- **A version is rewritten in place until a test students can REACH pins it.** Status decides
  nothing here. Reachable means the test has been offered and its earliest opening has passed —
  which is a `min()` across program unlocks, not `Test.opensAt` alone, and a null `opensAt` means
  open now, not never. Until then an edit rewrites the one version row, so a question sitting on two
  unopened papers can be fixed once and both papers carry the fix. Once a reachable test pins it the
  edit inserts a new immutable version and repoints `currentVersionId`, so what that paper pinned
  never moves under a student; once the paper is sat, the database refuses the move too. The service
  is deliberately stricter than that database guard, which trips only at the first attempt: the
  service holds the policy and the database is the backstop, and they are not meant to agree.
- **A rewritten version drags every paper that pins it.** `PaperQuestion.optionIds` is a copy of the
  pinned version's option ids in stored order and an answer sheet stores a POSITION into it, so a
  trigger rebuilds that array on every pinning paper whenever a version's options change. Editing
  one test's copy of a question silently repairs every other unopened paper holding it.
- **Every path that touches both takes the TEST before the QUESTION, its tests in `id` order.**
  The offer and every paper edit already did; an edit now takes the same lock on the tests it reaches
  before it claims the question row, because the version guard reaches those tests anyway on the way
  out. Nothing enforces this but the rule: two admins crossing on one order deadlock, and Postgres
  kills one of them with a save the admin never asked to lose.
- **Proof-reading is per test, per section, question by question.** A reader sees the section's
  paper — typed and picked alike — once it has been handed to them, and nothing before. Each
  question is checked (`QuestionReview.checkedAt`) or sent back to the typist with a reason — a
  spelling mistake, a data correction, or no suitable option as the answer — and an optional note.
  Only the sent-back questions go back; the rest stay with the reader. The typist fixes one and
  marks it fixed, and it returns to be checked again. A minor fix the reader makes directly.
- **Releasing a section needs every question on its paper checked** and none still with the
  typist. It sets the reader's `finalizedAt` and ends their authority over it. A question added,
  drawn or swapped onto the paper after the release that the reader has not checked sends the
  section back to them in the same write once it is whole again (a short section stays with its
  owner to finish, since a reader only releases a whole one), and the offer refuses any question on
  a read section without its tick — one definition of read, the tick, for release and offer alike.
  Rewording a question — its content, options or key, from any screen — drops its ticks on every
  draft, whether its paper holds the question now or it was taken off and may come back, and sends
  a released whole section holding it back to its reader the same way.
- **A question written for a section is changed and deleted only on that section's page**, under
  the rule of the viewer's seat there; the typist's own editor holds only what they typed straight
  into the bank. A typist whose role passed to somebody else only reads; the section's last typist,
  stood down with nobody after them, still fixes the section's drafts and deletes their own, since
  nobody else can. A super admin acts through whoever holds a role now.
- **A test owner changes a question only when the section is back with them**: a picked section
  before it is handed over, or any section once its reader has released it — and never once the
  test is offered.
- **A section's thread belongs to its section.** Its typist and proof-reader read and write it; a
  test owner (TEST_MANAGEMENT) and a super admin read it, and a super admin may write. Anyone
  else is told there is no such section — holding a typist's or reader's key is not a seat on it.
  A comment is reworded only by its own author.
- **Being depended on is what freezes a question, not being published.** Nothing a `PaperQuestion` or
  `TestQuestionStat` references may be deleted; every served question is a paper row a sat test
  cannot lose, and the rule counts those two tables before it allows the move, so it refuses before
  a foreign key does.
- **Subject and topic settle when something DEPENDS on the question, not when it is published.**
  Taxonomy is what a section draws on, so moving it afterwards would change what a finalized paper
  was built from — and a `PaperQuestion` records no subject of its own, so a moved question would be
  served inside a section it no longer belongs to and counted there.
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
  tables and typed equations are **not** read from a sheet — a tag typed into a cell shows as the
  tag. Rich content is added by opening the question in the bank afterwards.
- **Equations are, written as LaTeX between `\(` and `\)`** in a question, option or solution
  cell. Each becomes the same inline formula the editor writes, and one KaTeX cannot draw is an error
  on its line. `\( … \)`, not dollars: "$5 and $10" would read as one formula.
- **Pictures are.** A picture floating over a question, option or solution cell (its top-left corner
  in that cell — how ThinkExam exports its figures and formula images) is imported into that field;
  over any other column it is an error. Where the text leaves exactly one gap of three spaces per
  picture they fill the gaps in order, otherwise they follow the text — an anchor carries no
  position within the cell, so a picture is never put in a gap it only might belong to. They are
  keyed by a hash of their bytes, so a re-upload still matches its own questions as duplicates, and
  uploaded only on commit. The rejected-rows download cannot carry them, and says so on those rows.
  A picture no taller than a line of text (`FORMULA_PICTURE_MAX_HEIGHT`) is a formula saved at
  screen resolution: the preview warns that it will read blurry and to retype it as `\( … \)`, but
  the row still imports.
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
  end is normal. Duplicates are found by normalised stem hash: case, spacing, markup and stray
  punctuation fold away, but signs, dashes, `%`, `/` and a decimal point between digits do not —
  "x = 2.5" and "x = 25" are two questions. Each row records the fold its hash was made with
  (`stemHashVersion`); changing the fold means bumping `STEM_HASH_VERSION`, and the worker rehashes
  every older row at boot.
- **Rows are corrected before Import, not after.** The preview opens every row, a Skip row included,
  on the authoring page, one card per row; a saved correction is held against the run and its line (`ImportRowEdit`),
  never in the bank, and every row is judged again at once, so a fixed row turns to Create and a
  correction that now repeats another becomes a duplicate. Import lays the corrections over the
  re-read file and judges it all once more. Only the admin who previewed a run may correct or
  import it, and not once it is imported. A run is imported only where it was previewed — the
  bank's importer, or that one section's (`ImportLog.target`); a run from before the target was
  kept imports through either. Sheet pictures are stored at preview so the page can draw them.
- **A row can be left out, and brought back.** Leaving one out is held on the same `ImportRowEdit`,
  so a corrected row brought back keeps its correction. A row left out writes nothing and claims
  neither its stem nor its code, so a later copy of it in the same file imports as Create.
- Every imported question carries the `imported` tag, so one filter finds what an upload brought in.
- An upload is bounded so it stays a single synchronous request.

Two intake paths: this sheet for bulk MCQs, pictures included, and the rich manual editor for
typed equations, tables and for placing a picture the sheet could only put after the text.

## 13. A worked blueprint — SSC CGL Tier 1

The official patterns are seeded (`prisma/seed.sql`); IACE validates
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
