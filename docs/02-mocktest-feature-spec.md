# IACE V1 — Mock-Test Feature Spec

**Purpose:** Define the first feature of the IACE platform — online mock tests — built to replace ThinkExam and fix what it does badly.
**Basis:** Direct study of your live ThinkExam admin + student portals (examprep.iace.co.in), plus your design decisions.
**Companion doc:** _IACE Learning Platform — V1 Architecture & Build Plan_ (stack, scaling, AWS, 45-day roadmap).
**Last updated:** 2026-08-31

---

## 1. The guiding principle

We are not cloning ThinkExam — we're **keeping what works, simplifying the friction, and upgrading the three things that cost you the most time and trust.** The whole spec flows from what we verified on your live account:

- **Admin is slow and heavy.** Snappy admin is a first-class V1 requirement, not a nice-to-have.
- **Question import is brittle.** We saw real uploads land "Total: 321 | Accepted: 5 | Error: 316." A forgiving importer is core.
- **Rank/result is manual.** "Generate Rank" and "Regenerate Result" are separate buttons, and even "Automatic" snapshots the pool — so ranks go stale for open tests. We make ranking **always live**.
- **Test creation is a rigid 6-step wizard** with clunky question mapping. We make it **config-driven and mostly automatic.**

Everything below serves those four fixes.

---

## 2. Replicate / Simplify / Upgrade / Discard

| Area                                                                                      | Decision                    | Detail                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-exam student UI (timer, palette, sections, per-question language)                    | **Replicate**               | This is the student's #1 expectation. Rebuild the standard government-CBT layout faithfully.                                                                                                                                            |
| Test-taking UI                                                                            | **Simplify → render modes** | Replace ThinkExam's theme gallery with a small closed set of render modes on the base config (`defaultTestUi`: CBT, OMR, GENERIC, TYPING) over **one** engine, one clock, one paper. See §14.                                           |
| Category / series buckets                                                                 | **Simplify → flat**         | Their tests live in a nested Category tree. Ours is `TestSeries`: **flat, no nesting**, many-to-many with tests. The tree bought browsing and cost a hierarchy nobody could keep tidy. See §9.                                          |
| Access model                                                                              | **Simplify**                | Access is to a **series**, never a test, by exam match, program match or one `StudentGrant`, each gated by the student's branch. **There are no groups or batches, and no shareable link.** No products, no access-code system. See §7. |
| Student portal UI                                                                         | **Upgrade (don't copy)**    | The current portal is too naive for today. Rebuild it snappy, uncluttered, with proper icons and a repeatable **tour**; make **Report the landing dashboard**. The in-_exam_ screen still mirrors the real government exam.             |
| 6-step creation wizard                                                                    | **Simplify**                | Collapse to a short, saveable flow; a base config pre-fills almost everything.                                                                                                                                                          |
| Question → test mapping                                                                   | **Simplify → Upgrade**      | Replace the flat manual list with **blueprint auto-draw** (subject + difficulty %) plus an easy manual picker.                                                                                                                          |
| Candidate creation (many required fields)                                                 | **Simplify**                | Mobile number is the only mandatory field; details completed after signup.                                                                                                                                                              |
| Rank & result generation                                                                  | **Upgrade**                 | Fully automatic, always-live via Redis leaderboard. No Generate/Regenerate buttons.                                                                                                                                                     |
| Question import                                                                           | **Upgrade**                 | Forgiving importer: preview, row-by-row error report, handles text + image + equation. One central import screen.                                                                                                                       |
| Certificates                                                                              | **Discard**                 | No "Create Certificate" step in V1.                                                                                                                                                                                                     |
| Long tail of test settings (bio break, essay/AI eval, open-book whitelisting, proctoring) | **Discard for V1**          | Keep only what our exams use. **OMR is not in this list** — it is a V1 render mode (§14).                                                                                                                                               |

---

## 3. The simplified test-creation flow (our design)

ThinkExam's flow is Create → Setting → Add Question → Publish → Assign → Certificate. Ours
compresses to **three steps plus a reusable blueprint**, and the blueprint does the heavy lifting.

**Phase 0 — Exam-type base configs (set up once, reused forever).**
A library of base configs keyed by exam stage (SSC CGL Tier 1, IBPS PO Prelims, RRB JE…). Each
holds the blueprint: sections and their subjects, per-section time, marks per question, negative
marking, total questions, timer template, navigation policy and shuffle rules. Admins rarely touch
these after setup. `BaseConfigSection.patternNote` is **not** a mix the draw reads — it holds the
exam-pattern workbook's note ("Moderate-Difficult") and nothing in the code reads it.

**Step 1 — Setup.** Name it, pick a base config, choose scope, evaluation mode and paper binding.
A test **inherits** its config's shape and does not override it: there is no per-test duration,
marks or timing. The way to change the shape is to clone the config (`clonedFromId` is the lineage).

**Step 2 — Paper.** What each section is drawn FROM is set here per section: its topics, and
optionally a count per difficulty. There is no test-wide difficulty default. What happens next
depends on the paper binding, which is the real fork — not "auto vs manual":

- **FIXED** — the admin **picks every question by hand**, from a pool the section's own
  configuration describes. Where a section sets counts per difficulty, those counts cap what may be
  shortlisted into each. Finalize freezes the result; every student sits it, and order and options
  are shuffled per student from `Attempt.shuffleSeed`.
- **GENERATED** — nothing is picked. The draw runs at finalize and produces `Test.variantCount`
  papers, and each attempt reads the one its seed lands on. RANKED forces FIXED, because a rank
  only means something if the cohort sat the same paper.

**Step 3 — Offer.** Which series carry the test, what each branch does differently for it (late
entry, extra time), and the freeze-and-publish that lets students reach it. Creation ends here.

**No certificate step.**

**Scheduling is the TEST's, not the series'.** `TestSeriesTest.unlockAt` is when a test opens
inside a series — one instant for every branch. `BranchTestSchedule(branchId, testId)` is what one
branch does differently: `lateEntrySec`, counted from that unlock, and `extraTimeSec`, added to the
clock. Both are null by default, and no row at all means the plain rules. A branch's hold on a
series has no window: it runs it indefinitely, or not at all.

**After creation — management actions (separate from the creation flow):**

- **Activate / Inactivate** the test (status toggle).
- **Assign access** — always to a **series**, never to a test: an exam match, a program match or a
  `StudentGrant`, gated by the branch's row (§7). There are no groups or batches.
- **Series membership** — many-to-many and optional; a test can be standalone, in one series or in
  several. It can be **removed from a series only while nobody has sat it**; an `Attempt` records a
  test and a student and never a series, so the question the data can answer is "has this test been
  sat at all".

**Locking rule:** once the first student starts, the paper and config **lock**. The only permitted
post-start change is **drop / bonus** a question (e.g. a bad key found mid-cycle) — which triggers
an **automatic score + rank recompute**.

---

## 4. Test settings — keep vs drop

From ThinkExam's Step 2 (Shuffle, Test Options, Time Setting, Generate Rank, Attempt & Resume, plus Bio Break / Report / Whitelist), we keep only the settings our exams need:

**Keep (V1), and built:** randomize question order; randomize answer options (stable option IDs); section-specific numbering; sectional timing (per-section minutes, flexible vs locked switching, optional-section count); marks + negative marking **per section**; resume (re-entering the running attempt; `Test.maxRetakes` caps how many separate sittings); per-question language toggle; response autosave every ~20–30s (vs their 4 min); a **watermark** carried by the skin (`PAPER`, `SCREEN` or `NONE` — §14); **late entry and extra time, per branch per test** (`BranchTestSchedule`) — extra time is where "for handicapped" folds in, as an allowance rather than a separate flow. Late entry BLOCKS starting the test; the student can still open it and read about it.

**Kept in principle, not yet built:** a resume LIMIT (nothing counts or caps re-entries into one sitting) and secure/full-screen mode.

**Drop (V1):** certificates, typing test, OMR, essay/AI subjective evaluation, open-book website whitelisting, bio-break scheduling, and most niche integration toggles.

---

## 5. Student experience — enhance, don't copy

We keep the _journey_ ThinkExam established, but its portal UI is too naive for today — so we rebuild it **snappy, uncluttered, icon-driven, and easy to scan**, with a **tour the student can replay anytime**. The one thing we replicate faithfully is the **in-exam screen** (students expect it to match the real government CBT). Everything around it, we modernize.

**Landing = Report dashboard.** After login the student lands on **Report as a friendly dashboard** (not a raw test list) — performance, progress, and next actions at a glance.

**Test area.** Card-based, tabs for **Active / Upcoming / Missed / Completed**, sidebar (Tests, Report, Bookmarks, Documents, Announcements), search. Each card: name, schedule window, duration, status (Start test / Incomplete / Expired). The current **Test and Report tabs are the least friendly** parts of ThinkExam — these get the most UX attention. Login becomes **mobile + OTP** (ThinkExam uses email+password today).

**Pre-exam.** A lightweight system check (ThinkExam runs a 4-step Browser/User/Test/CORS check — we keep a slim version), then instructions with the palette legend and a language selector, then a declaration checkbox and "I am ready to begin."

**Live exam UI (the core to replicate faithfully):** section tabs; server-authoritative **countdown timer**; per-question **type + marks/negative**; per-question **"View In" language** dropdown; full-screen; the question body (renders text, images, and **equations**); radio options; right rail with **status counters** (Answered / Not Answered / Not Visited / Marked for Review / Answered+Marked) and the **Questions Palette** grid; bottom bar **Mark for Review & Next / Clear Response / Save & Next**; Submit. _(This is the CBT variant, used for full-length mocks; lighter test types use the generic test UI — see §14.)_

---

## 6. Results & solutions model

Verified on the live report. We ship the core in V1 and fast-follow the rest.

**V1 core:** a **Score Card** (Rank, Marks, Percentage, **Percentile**, plus correct/incorrect/unattempted and attempted count) and a **Solution Report** — section-tabbed, per-question review showing the passage/stem, options with **"My Answer"** tagged and the **correct answer** marked, per-question marks and time, a color-coded palette (Correct / Incorrect / Skip / Unattempted), and a "Show all solutions" toggle for explanations.

**Data points captured from day one (non-negotiable):** answer-level detail per attempt — option chosen, correct/incorrect, marked-for-review state, and **time spent per question/section** — so analytics can be derived later without re-instrumenting.

**Analytics screen: shipped.** The student's Performance screen (`apps/test/src/routes/performance.tsx`) is live, computed from `Attempt` and `AttemptQuestion` directly. The deeper cuts are still fast-follow.

### The rollup tables — in the schema, written by nothing

Six tables were provisioned for the fast-follow so it costs no migration when it lands. **No code
writes any of them today**, and only one is read (`TestQuestionStat`, by the check that freezes a
question somebody has served). Columns and their exact meanings are in `docs/schema-target.dbml`;
what each one is FOR:

| Table                | Grain                                       | Backs                                                                                                                                                                          |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StudentStat`        | one row per student                         | The dashboard header — lifetime tests, averages (`sum… / testsEvaluated`), best percentile, accuracy, total time                                                               |
| `StudentSubjectStat` | student × subject × scope × evaluation mode | **Subject Report** — where a student is weak. Keyed by mode so practice never pollutes ranked                                                                                  |
| `TestStat`           | one row per test                            | **Compare Yourself** — cohort count, score sum/max/min, `scoreHistogram`, the topper's attempt                                                                                 |
| `TestSectionStat`    | test × section                              | Section-level cohort comparison and time utilisation                                                                                                                           |
| `TestQuestionStat`   | test × paper question                       | **Question Report** — classical item analysis: `pValue` (difficulty index), `discrimination`, and `optionCounts` for distractor analysis. FIXED papers only                    |
| `ProcessedRollup`    | attempt × rollup type                       | Not analytics — the **exactly-once guard**. A retried or redelivered evaluation checks here first, so a worker retry cannot double-count an attempt into any of the five above |

Two design points already settled in the schema and worth not relitigating: every aggregate stores
**sums and counts, not averages**, so a rollup is incremental and a retry is cheap; and
`discrimination` is explicitly **batch-only** — it compares a top group against a bottom group and
cannot be maintained one attempt at a time.

The data these fold up from — option chosen, correct/incorrect, marked-for-review, time per question
— is captured on `AttemptQuestion` from day one, which is why none of this needs a migration.

**Ranking:** computed live from a Redis sorted set. Open tests show "your rank as of now, out of N"; fixed-time tests rank only those who attempted in the window. Ties handled per config (allow duplicate ranks / skip after duplicate). Drop/bonus corrections auto-recompute.

---

## 7. Access model — Student → Test Series → Test

**There are no groups.** A student reaches a `TestSeries` by one of three paths, and every one of
them is then gated by the `BranchTestConfig` row for their current branch:

1. **Exam match** — the series sits on a stage of an exam in `Student.enrolledExams`. Only for a
   series with no `programCode`.
2. **Program match** — the series carries a `programCode` the student carries. A program-tagged
   series is program-ONLY: an exam enrolment alone never opens a cohort's paper to somebody
   outside the cohort.
3. **`StudentGrant`** — one explicit row, the escape hatch for access that is not exam-, program-
   or branch-derivable.

A student with no current branch reaches nothing, grants included: the enable flag lives on the
branch's row, so there is nowhere for the answer to come from. That row carries **no window** — a
branch runs a series indefinitely or not at all, and a series has no availability of its own.

**When a student may start is the TEST's answer, not the series'.** Each test in the catalog
carries `opensAt` (the series↔test `unlockAt`) and `closesAt` (that plus the student's branch
`lateEntrySec`, null unless both halves exist), and `canStart` is derived from the clock on **every
read** rather than cached — so a test opens on time with nothing having to bust a cache key. The
branch's `extraTimeSec` is added to the configured duration once, where the server computes
`endsAt`.

**Which path applies depends on the series' `kind`, and only one does.** `STANDARD` reaches a
student enrolled in the course its stage belongs to, whose current branch is on the series'
`branchIds`. `FREE` reaches every student. `PROGRAM` reaches only students carrying its
`programCode`. `EVENT` reaches only the candidates on its `Event`. A `StudentGrant` is an override
that reaches past all four, and the whole answer is gated by the series' own `isEnabled` — a series
nobody switched on reaches nobody. Four database CHECKs hold the shape: a non-FREE series names a
stage, `PROGRAM` names a program and nothing else does, `EVENT` names an event and nothing else
does, and only `STANDARD` may carry branches.

There is no ask queue and nothing to request: a series is reached or it is not.
`isTestBlocked` leaves the whole catalog readable and starts nothing.
`sequentialTests` gates the tests INSIDE a series: the first one not yet sat is open and everything
after it waits, counted from submitted and evaluated attempts and read fresh on every catalog read,
so submitting one opens the next with nothing having to bust a cache.

One function answers all of it (`AccessResolverService`), and both callers read that one answer:
the student's catalog and the attempt-start guard. In-app `Notification` on assignment, carrying
`testSeriesId` as the deep link.

This scales to the general-public rollout unchanged: access is managed at the **series** level,
never per test, and the only per-student row in the model is the grant.

---

## 8. Data-model additions (beyond the base architecture doc)

> **`prisma/schema.prisma` is the authoritative model (37 models).** The bullets below summarize
> it. Where this file and the schema disagree, the schema is right and this list is stale.

- **Student / Admin** — separate tables. Student: `mobile` and `studentType` are mandatory, and
  `mobile` is unique among LIVE rows only. Admin: `email`, `isSuperAdmin`, and one row per grant
  in `AdminFeaturePermission(adminId, featureKey, level)` — feature keys are code-owned, and there
  is no `Feature` table. OTP, sessions, and device binding live in **Redis**, not the DB.
- **StudentProfile (1:1)** — email, address, gender, dob, photo, education + past-exam history
  (JSON). Aadhaar and PAN are `aadhaarVerified` / `panVerified` booleans; **the images are never
  stored**, so the photo is the only upload. `preTestReady` (mother's + father's name + DOB)
  prompts before a test; `profileCompleted` only drives a nudge and **never blocks**.
- **Exam / ExamStage / BaseConfig (+ BaseConfigModule, BaseConfigSection)** — the taxonomy is
  `ExamCourse` (enum) → `Exam` → `ExamStage`, and the STAGE is what everything hangs off. A
  BaseConfig is a stage's blueprint and a Test **inherits** its shape rather than copying it.
  Marks, negative marks, timing and merit/qualifying are **per section**. A config locks at the
  first finalize built from it; the way to change a locked one is to clone it.
- **Question / QuestionVersion** — `Question` is identity (type, taxonomy, status, tags,
  `stemHash`, `currentVersionId`). Every edit inserts an **immutable** `QuestionVersion` holding
  content, options as JSON and the answer key, then repoints `currentVersionId` — so a paper or an
  attempt that pinned a version never moves. Option ids carry over by position. Localized content
  is JSON keyed by language, rich (text / `$LaTeX$` / inline **S3 image URL**). **No separate
  media table, and no `QuestionOption` table.**
- **Subject / Topic** — two levels only. A `Topic` belongs to exactly one Subject, and anything
  finer is a `topic:` tag on the question. A question's `topicId` must belong to its `subjectId` —
  enforced in the service, since no foreign key can express it.
- **Test** — links a BaseConfig (and, denormalised, its stage, so a composite FK enforces the
  pair); scope, evaluation mode, paper binding, draw strategy, `variantCount`, status, lock state.
- **PaperQuestion (frozen paper)** — one paper per `variant`; a FIXED test has variant 0 alone,
  hand-picked and frozen at finalize, and a GENERATED test has `Test.variantCount` of them drawn
  at finalize. Per-question marks/negative; status (**active / dropped / bonus**). Per-student
  order comes from `Attempt.shuffleSeed`, not from a second paper.
- **Attempt** — live state (`startedAt`, server `endsAt`, `sectionState`, `status`, `shuffleSeed`,
  `attemptNo`, `languages`) **and** the scored fields (`score`, counts, `sectionScores`, `lastRank`,
  `lastPercentile`). **No separate Result table, and no resume counter** — resume is re-entering the
  running attempt, and `@@unique(testId, studentId, attemptNo)` is what makes two racing starts one
  sitting.
- **AttemptQuestion** — only questions the student **interacted with** (composite PK): option
  chosen, state, time; (post-scoring) isCorrect, marksAwarded. The analytics data points, captured
  day one.
- **Access** — `Program`, `TestSeries` (carrying `kind`, `branchIds`, `isEnabled`, `eventId`),
  `TestSeriesTest` (carrying `unlockAt`), `StudentGrant`, `BranchTestConfig` (a switch, no window),
  `BranchTestSchedule(branchId, testId)` for late entry and extra time, and `Event` /
  `EventCandidate` for an EVENT series' roster. See §7 — there is no group table, no ask queue and
  no student↔test link.
- **TestSeries** — many-to-many with Test, optional, **flat** (no nesting). Standalone attempts
  allowed. Marks use `Decimal(6,2)`.

---

## 9. Decisions locked

- Paper binding is the fork: **FIXED** freezes one hand-picked paper every student sits; **GENERATED** draws `Test.variantCount` papers at finalize and each attempt reads the one its seed lands on. RANKED forces FIXED. Per-student shuffle of order & options via `Attempt.shuffleSeed` either way.
- Difficulty is **per section only** — what a section is drawn from, optionally a count per difficulty. There is no test-wide default (§3).
- Post-start corrections = drop/bonus with automatic recompute; otherwise locked.
- **Base config locks once used** — once any test created from a base config is attempted, the config + its sections become read-only; to change it, clone into a new config. (Tests are snapshots, so existing ones are unaffected regardless.)
- Rank/result = always live (Redis), never a manual regenerate.
- Central question bank with one forgiving import screen; text + image + equation.
- Students: mobile + OTP **at signup**, then a **4-digit PIN** for later logins (OTP resets it; rate-limit in Redis). Admins: email + OTP. OTP/sessions/devices in Redis. **Pre-test gate is minimal** — mother's name + father's name + DOB; the full profile is optional and gently prompted.
- No certificates in V1; trimmed settings.
- Access = **Student → TestSeries → Test**, by exam match, program match or an explicit `StudentGrant`, every one of them gated by the student's branch (`BranchTestConfig`). **No groups.** No products/access-codes.
- **Three portals:** Student (future broad platform), **Test** (this build, `apps/test`), Admin. V1 = Test + Admin. Internal IACE students first, general public later.
- Student portal is **enhanced, not copied**: snappy, uncluttered, icon-driven, with a replayable tour; **Report is the post-login landing dashboard**; Test and Report tabs get the most UX care. The in-exam screen still mirrors the real exam.
- All analytics data points captured from day one; per-test analytics screen built this phase if quick, else fast-follow.
- Category/test series is **decoupled from creation** — optional, many-to-many, assigned as a separate flow; a test can be attempted individually.
- Test **status (active/inactive)** and **access (which branches run a series, and when)** are post-creation management actions, not part of the creation flow.
- **Render modes, not themes** — `BaseConfig.defaultTestUi` picks one of CBT, OMR, GENERIC, TYPING; `Test.examTemplate` picks the skin (COMFORTABLE or STRICT). One engine underneath all of them. §14 says what is built. The portal/admin app shell is a separate, single modern design system.
- **Language display is per test** (`languageMode`, defaulted from base config): **SINGLE** (pick one, optional per-question toggle) or **DUAL** (both languages shown together — stem + options — no toggle). All content is already in the JSON; it's purely a render mode. `BaseConfig.languages` is the **ordered** list that drives render order and a test inherits it; `Attempt.languages` records what the student was actually served.

---

## 10. Still needed from you

1. ✅ Sample import file received and analyzed — redesigned format in §12.
2. ✅ First exam decided: **SSC CGL Tier 1** — base config in §13.
3. ✅ Difficulty settled: **per section only**, as a count per difficulty on what the section draws
   from. There is no test-wide default to confirm.
4. Still useful: one real question file with an **image-based** and an **equation** question, so the
   importer's media handling matches your real content.

---

## 11. Build order (mock-test feature, within the 45 days)

1. Central question bank + forgiving importer (text → then image/equation).
2. Exam-type base configs.
3. Test creation: Step 1 (config-driven) → Step 2 auto-draw + manual picker → Step 3 schedule/assign.
4. The live exam engine (the hard, high-value part): sections, timer, palette, per-question language, autosave, safe submit. **CBT interface = primary; the generic test UI only if time remains.**
5. Scoring workers + live rank/percentile + Score Card + Solution Report.
6. Lock + drop/bonus recompute; hardening + load test.

---

## 12. Question import — a better format

**What ThinkExam does (and why imports fail).** Their sample is a single flat sheet of **51 columns**: 16 English option columns + 16 Hindi option columns (nearly all empty), correct answer as a **letter (a/b/c/d)** tied to option position, free-text subject/topic (their own sample even misspells "General Awarness"), an opaque difficulty code, and numeric/essay crammed in via RANGE FROM/TO and ESSAY CODE. The width, rigidity, and letter-based key are exactly why uploads land "5 accepted / 316 error."

**Our format — narrow, forgiving, multilingual by rows not columns.** One row per **(question × language)**, linked by `question_code`; English row required, other languages are extra rows — never extra columns:

`question_code | language | subject | topic | sub_topic | difficulty | question | option_1 | option_2 | option_3 | option_4 | correct_option | marks | negative_marks | solution | tags`

Choices that fix the pain:

- **Correct answer by option index (1–4)**, converted to a **stable option ID** on ingest — so later shuffling or editing never breaks the key.
- **Multilingual by rows** (not 32 option columns) → English default; Hindi/Telugu/any language just add rows, no schema change. Serves the multi-language goal directly.
- **Equations** inline as `$…$` (KaTeX); **images** as `[[img:filename]]` placeholders resolved from an uploaded image **ZIP** → clean image-only and equation questions.
- **Validated taxonomy** (subject/topic/sub-topic/difficulty from controlled lists, create-on-confirm) → no typo-driven rejections. A `sub_topic` is matched against existing rows first and, if new, attached to the row's topic — an unrecognised one is offered for confirmation, never quietly duplicated.
- **Preview + row-level validation:** parse → preview grid with per-row errors → fix in place or download an error report → commit only valid rows. No silent mass rejection.
- **Duplicate detection** via normalized-stem hash.
- Two intake paths: this Excel/CSV importer for bulk text MCQs; the **rich manual editor** (image upload + equation) for image/equation-heavy questions. A Word parser is post-V1.

---

## 13. SSC-CGL Tier 1 — base config (first exam)

Confirmed against the current pattern; IACE validates as the domain expert.

- **Exam type:** SSC CGL — Tier 1
- **Sections (4), single-answer MCQ, 4 options, bilingual (English + Hindi; English Comprehension is English-only):**
  1. General Intelligence & Reasoning — 25 Q
  2. General Awareness — 25 Q
  3. Quantitative Aptitude — 25 Q
  4. English Comprehension — 25 Q
- **Total:** 100 questions, 200 marks
- **Marking:** +2 correct, −0.5 wrong, 0 unattempted
- **Duration:** 60 min (80 min for PwD) — **single overall timer, no sectional timing, free navigation, no sectional cut-off**
- **Calculator:** none
- **Shuffle:** randomize question order + options per student
- **Language display:** DUAL (English + Hindi shown together) by default; English Comprehension section English-only
- **Default difficulty mix (editable, per-section overridable):** 30% Low / 50% Medium / 20% High

**Note:** SSC CGL **Tier 2** is a separate base config (different structure, Paper I negative marking of 1, sectional timing) — add later.

---

## 14. Test-taking UI — render modes over one engine

There is **one** exam engine: one clock, one paper, one scoring path. Everything below is
presentation, and that is the whole point — a per-exam theme gallery is what we refused.

Two independent axes:

**`BaseConfig.defaultTestUi` — how the student ANSWERS.** Four values, and a test inherits the
config's:

1. **CBT** — the faithful government-CBT screen: palette, server timer, section tabs,
   Save & Next / Mark for Review / Clear Response, per-question language. Used for full-length
   mocks; the V1 focus.
2. **OMR** — the same paper, answered by **bubbling** rather than picking a radio option: the
   student darkens a bubble the way they would on a real sheet. It is an INPUT AFFORDANCE ONLY —
   the engine, the clock, the paper, the navigation and the scoring are the default ones,
   unchanged. Nothing about an OMR sitting is scored differently.
3. **GENERIC** — a lighter, modern screen for daily tests, sectional/topic practice and quizzes
   that do not need the exam-hall replica.
4. **TYPING** — a typed-answer screen, for the formats that ask for one.

**`Test.examTemplate` — where things SIT.** `COMFORTABLE` or `STRICT`, resolved through one shared
`EXAM_TEMPLATE_CONFIG` so the admin's preview cannot describe a screen the student does not get. It
fixes timer position and format, palette side, section switching, and the watermark
(`PAPER` / `SCREEN` / `NONE`).

**What is built today.** `examTemplate` is done end to end — both templates render
(`apps/test/src/components/exam/templates/`), the sitting picks one, and the admin previews it.
`defaultTestUi` is **stored and chosen in the admin base-config form, and the sitting does not yet
branch on it** — every test renders the one screen. OMR, GENERIC and TYPING are committed V1 intent
with the field in place; the render modes are still to build.

All IACE exam formats (SSC CGL/CHSL, IBPS/SBI Banking, RRB JE/NTPC/Group D, SI/Constable) share the
CBT mode; their differences are **config-level, not template-level**:

- **Sectional timing on/off + locked vs free section switching** — Banking prelims/mains use
  sectional timing with locked sections; SSC CGL Tier 1 is one timer, free navigation.
- **Optional on-screen calculator** — Banking Mains provides one; SSC does not.
- Section counts, question counts, and marking — all config.

(Separately, the student portal + admin **app shell** is its own single modern design system — see
§5. That is distinct from these render modes.)
