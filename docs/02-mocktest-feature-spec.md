# IACE V1 — Mock-Test Feature Spec

**Purpose:** Define the first feature of the IACE platform — online mock tests — built to replace ThinkExam and fix what it does badly.
**Basis:** Direct study of your live ThinkExam admin + student portals (examprep.iace.co.in), plus your design decisions.
**Companion doc:** *IACE Learning Platform — V1 Architecture & Build Plan* (stack, scaling, AWS, 45-day roadmap).
**Last updated:** 2026-08-10

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

| Area | Decision | Detail |
|---|---|---|
| Real-exam student UI (timer, palette, sections, per-question language) | **Replicate** | This is the student's #1 expectation. Rebuild the standard government-CBT layout faithfully. |
| Test-taking UI | **Simplify → two variants** | Replace ThinkExam's theme gallery with just **two** test-screen UIs, chosen per test: the **standard government CBT interface** (all our exam formats share it; V1 focus) and a **generic test UI** for lighter types (daily/sectional/quiz). See §14. |
| Category / series buckets (nested tree) | **Replicate** | Your tests already live in a nested Category tree (SBI & IBPS PO Prelims, Banking Mains 100 Days, Sectionwise Tests…). Keep it as the series/bucket layer. |
| Access model | **Simplify** | Two ways only to grant a test: to a whole **batch/group**, or to **individual students** via a paginated picker (off by default). Plus a shareable generated link. **No products, no access-code system.** |
| Student portal UI | **Upgrade (don't copy)** | The current portal is too naive for today. Rebuild it snappy, uncluttered, with proper icons and a repeatable **tour**; make **Report the landing dashboard**. The in-*exam* screen still mirrors the real government exam. |
| 6-step creation wizard | **Simplify** | Collapse to a short, saveable flow; a base config pre-fills almost everything. |
| Question → test mapping | **Simplify → Upgrade** | Replace the flat manual list with **blueprint auto-draw** (subject + difficulty %) plus an easy manual picker. |
| Candidate creation (many required fields) | **Simplify** | Mobile number is the only mandatory field; details completed after signup. |
| Rank & result generation | **Upgrade** | Fully automatic, always-live via Redis leaderboard. No Generate/Regenerate buttons. |
| Question import | **Upgrade** | Forgiving importer: preview, row-by-row error report, handles text + image + equation. One central import screen. |
| Certificates | **Discard** | No "Create Certificate" step in V1. |
| Long tail of test settings (bio break, typing test, OMR, essay/AI eval, open-book whitelisting, proctoring) | **Discard for V1** | Keep only what our exams use. |

---

## 3. The simplified test-creation flow (our design)

ThinkExam's flow is Create → Setting → Add Question → Publish → Assign → Certificate. Ours compresses to **three phases plus scheduling**, with a reusable config doing the heavy lifting.

**Phase 0 — Exam-type base configs (set up once, reused forever).**
A library of base configs keyed by exam type (SSC CGL, IBPS PO Prelims, RRB JE, SI/Constable…). Each base config holds the blueprint: sections/subjects, per-section time, marks per question, negative marking, total questions, default difficulty mix, and shuffle rules. Admins rarely touch these after setup.

**Step 1 — Create test.** Name it, pick a base config → everything pre-fills. Admin overrides only if this test differs. (Replaces ThinkExam's Step 1 + most of Step 2.)

**Step 2 — Fill with questions (two modes).**
- **Auto (blueprint draw):** from the base config's subjects and the difficulty split (a test-wide default with **per-section override**), the system auto-draws matching questions from the central bank into each section. The draw happens **once at finalize**, producing a **fixed paper every student shares** (fair ranking). Order and options are shuffled **per student** via a stored seed.
- **Manual:** a fast search/filter UI over the bank; admin cherry-picks questions and assigns them into sections.

**Step 3 — Schedule.** Publish window (start/end date + time), late-entry cutoff, extra time. Creation ends here with a fully **defined** test.

**No certificate step.**

**After creation — management actions (separate from the creation flow):**
- **Activate / Inactivate** the test (status toggle).
- **Assign access** — to a batch/group, or to individual students (§7).
- **Assign to test series** — **optional and many-to-many**: a test can be standalone (attempted individually), in one series, or in several. Kept deliberately **out of creation** as its own flow; series membership can be decided anytime, later.

**Locking rule:** once the first student starts, the paper and config **lock**. The only permitted post-start change is **drop / bonus** a question (e.g. a bad key found mid-cycle) — which triggers an **automatic score + rank recompute**.

---

## 4. Test settings — keep vs drop

From ThinkExam's Step 2 (Shuffle, Test Options, Time Setting, Generate Rank, Attempt & Resume, plus Bio Break / Report / Whitelist), we keep only the settings our exams need:

**Keep (V1):** randomize question order; randomize answer options (needs stable option IDs); grouping/section-specific numbering; sectional timing (per-section minutes, mandatory, flexible vs locked switching, optional-section count); marks + negative marking **per question** (bulk-settable); pause/resume with a resume limit; secure/full-screen mode; enrollment-number watermark; per-question language toggle; response autosave (we'll do ~20–30s vs their 4 min).

**Drop (V1):** certificates, typing test, OMR, essay/AI subjective evaluation, open-book website whitelisting, bio-break scheduling, "for handicapped" as a separate flow (fold into extra-time), and most niche integration toggles.

---

## 5. Student experience — enhance, don't copy

We keep the *journey* ThinkExam established, but its portal UI is too naive for today — so we rebuild it **snappy, uncluttered, icon-driven, and easy to scan**, with a **tour the student can replay anytime**. The one thing we replicate faithfully is the **in-exam screen** (students expect it to match the real government CBT). Everything around it, we modernize.

**Landing = Report dashboard.** After login the student lands on **Report as a friendly dashboard** (not a raw test list) — performance, progress, and next actions at a glance.

**Test area.** Card-based, tabs for **Active / Upcoming / Missed / Completed**, sidebar (Tests, Report, Bookmarks, Documents, Announcements), search. Each card: name, schedule window, duration, status (Start test / Incomplete / Expired). The current **Test and Report tabs are the least friendly** parts of ThinkExam — these get the most UX attention. Login becomes **mobile + OTP** (ThinkExam uses email+password today).

**Pre-exam.** A lightweight system check (ThinkExam runs a 4-step Browser/User/Test/CORS check — we keep a slim version), then instructions with the palette legend and a language selector, then a declaration checkbox and "I am ready to begin."

**Live exam UI (the core to replicate faithfully):** section tabs; server-authoritative **countdown timer**; per-question **type + marks/negative**; per-question **"View In" language** dropdown; full-screen; the question body (renders text, images, and **equations**); radio options; right rail with **status counters** (Answered / Not Answered / Not Visited / Marked for Review / Answered+Marked) and the **Questions Palette** grid; bottom bar **Mark for Review & Next / Clear Response / Save & Next**; Submit. *(This is the CBT variant, used for full-length mocks; lighter test types use the generic test UI — see §14.)*

---

## 6. Results & solutions model

Verified on the live report. We ship the core in V1 and fast-follow the rest.

**V1 core:** a **Score Card** (Rank, Marks, Percentage, **Percentile**, plus correct/incorrect/unattempted and attempted count) and a **Solution Report** — section-tabbed, per-question review showing the passage/stem, options with **"My Answer"** tagged and the **correct answer** marked, per-question marks and time, a color-coded palette (Correct / Incorrect / Skip / Unattempted), and a "Show all solutions" toggle for explanations.

**Data points captured from day one (non-negotiable):** answer-level detail per attempt — option chosen, correct/incorrect, marked-for-review state, and **time spent per question/section** — so analytics can be derived later without re-instrumenting.

**Analytics screen:** if the per-test analytics UI is quick to build, we ship it in this phase; otherwise it's fast-follow (Subject Report, Question Report, Compare-Yourself, time-utilisation, difficulty). Either way the data is already there — no migration needed.

**Ranking:** computed live from a Redis sorted set. Open tests show "your rank as of now, out of N"; fixed-time tests rank only those who attempted in the window. Ties handled per config (allow duplicate ranks / skip after duplicate). Drop/bonus corrections auto-recompute.

---

## 7. Access model — Student → Group → Test Series → Test

There is **no product concept** and **no direct student↔test or student↔series link**. Access flows entirely through groups:

1. A **student is always in ≥1 group** (batch) — that's how students are organized.
2. A **group is linked to test series** (many-to-many).
3. A **test series contains tests** (many-to-many).

So a student can access exactly the tests that sit in the series linked to their groups. To give a batch a set of tests, link their group to the series; to give one person access, put them in the right group. A `shareSlug` link exists for edge cases (public / one-off). In-app `Notification` on assignment.

This scales cleanly to the general-public rollout: everyone belongs to a group (even a default "public" group), and access is managed at the **series** level — never per test or per student.

---

## 8. Data-model additions (beyond the base architecture doc)

> **`prisma/schema.prisma` is the authoritative model (19 models).** The bullets below summarize it.

- **Student / Admin** — separate tables. Student: `mobile` is the only mandatory field. Admin: `email`, `isSuperAdmin`, page-level permissions (`Page` + implicit M:N). OTP, sessions, and device binding live in **Redis**, not the DB.
- **StudentProfile (1:1)** — email, address, gender, dob, photo, Aadhaar/PAN links, education + past-exam history (JSON). `Student.profileCompleted` gates the first test and is true once **photo + DOB + gender + Aadhaar + PAN** are present.
- **ExamType / BaseConfig (+ BaseConfigSection)** — reusable blueprint: sections, per-section time, marks, negative marking, total questions, default difficulty mix, shuffle rules. A Test copies + overrides it.
- **Question / QuestionOption** — options carry a **stable id + isCorrect** (the answer key survives shuffling/editing). Localized content is **JSON** (`Question.content`, `QuestionOption.text`) keyed by language; each field is rich (text / `$LaTeX$` / inline **S3 image URL**). Tags: subject, topic, difficulty (L/M/H). One question, reused everywhere; dedup on import. **No separate media table.**
- **Test** — links a BaseConfig; overrides, schedule window, **status (active/inactive)**, lock state, `shareSlug`. Independent of any series.
- **TestSection** — per-section time, mandatory, marks/negative, difficulty override, order.
- **PaperQuestion (frozen paper)** — the fixed questions drawn at finalize; per-question marks/negative; status (**active / dropped / bonus**).
- **Attempt** — live state (`startedAt`, server `endsAt`, `sectionState`, `status`, `shuffleSeed`, `resumeCount`) **and** the scored fields (score, correct/wrong/unattempted, sectionScores, rank/percentile). **No separate Result table.**
- **AttemptAnswer** — only questions the student **interacted with** (composite PK): option chosen, state, time; (post-scoring) isCorrect, marksAwarded. These are the analytics data points, captured day one.
- **Access** — a test grants access to **groups** and/or **individual students** via implicit M:N on `Test`, plus a `shareSlug` link. No product/access-code entities. `Notification` on assignment.
- **TestSeries** — many-to-many with Test (implicit), optional, **flat** (no nesting). Standalone attempts allowed. Marks use `Decimal(6,2)`.

---

## 9. Decisions locked

- Fixed paper for all students; per-student shuffle of order & options via seed.
- Difficulty split = test-wide default with per-section override.
- Post-start corrections = drop/bonus with automatic recompute; otherwise locked.
- **Base config locks once used** — once any test created from a base config is attempted, the config + its sections become read-only; to change it, clone into a new config. (Tests are snapshots, so existing ones are unaffected regardless.)
- Rank/result = always live (Redis), never a manual regenerate.
- Central question bank with one forgiving import screen; text + image + equation.
- Students: mobile + OTP **at signup**, then a **6-digit PIN** for later logins (OTP resets it; rate-limit in Redis). Admins: email + OTP. OTP/sessions/devices in Redis. **Pre-test gate is minimal** — mother's name + father's name + DOB; the full profile is optional and gently prompted.
- No certificates in V1; trimmed settings.
- Access = **Student → Group → TestSeries → Test** (no direct student/test grants). A student is always in ≥1 group; groups link to series; series contain tests. A shareSlug link for edge cases. No products/access-codes.
- **Three portals:** Student (future broad platform), **Test** (this build, `apps/test`), Admin. V1 = Test + Admin. Internal IACE students first, general public later.
- Student portal is **enhanced, not copied**: snappy, uncluttered, icon-driven, with a replayable tour; **Report is the post-login landing dashboard**; Test and Report tabs get the most UX care. The in-exam screen still mirrors the real exam.
- All analytics data points captured from day one; per-test analytics screen built this phase if quick, else fast-follow.
- Category/test series is **decoupled from creation** — optional, many-to-many, assigned as a separate flow; a test can be attempted individually.
- Test **status (active/inactive)** and **access (groups/individuals)** are post-creation management actions, not part of the creation flow.
- Two test-taking UIs, chosen per test: the standard government CBT interface (**primary V1 build**; full mocks; all formats share it) and a generic test UI (**secondary — only if time permits**, for lighter types). The portal/admin app shell is a separate, single modern design system.
- **Language display is per test** (`languageMode`, defaulted from base config): **SINGLE** (pick one, optional per-question toggle) or **DUAL** (both languages shown together — stem + options — no toggle). All content is already in the JSON; it's purely a render mode.

---

## 10. Still needed from you

1. ✅ Sample import file received and analyzed — redesigned format in §12.
2. ✅ First exam decided: **SSC CGL Tier 1** — base config in §13.
3. Confirm the **default difficulty buckets** per section (I've defaulted 30% Low / 50% Med / 20% High — you'll tune these).
4. Still useful: one real question file with an **image-based** and an **equation** question, so the importer's media handling matches your real content.

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

`question_code | language | subject | topic | difficulty | question | option_1 | option_2 | option_3 | option_4 | correct_option | marks | negative_marks | solution | tags`

Choices that fix the pain:
- **Correct answer by option index (1–4)**, converted to a **stable option ID** on ingest — so later shuffling or editing never breaks the key.
- **Multilingual by rows** (not 32 option columns) → English default; Hindi/Telugu/any language just add rows, no schema change. Serves the multi-language goal directly.
- **Equations** inline as `$…$` (KaTeX); **images** as `[[img:filename]]` placeholders resolved from an uploaded image **ZIP** → clean image-only and equation questions.
- **Validated taxonomy** (subject/topic/difficulty from controlled lists, create-on-confirm) → no typo-driven rejections.
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

## 14. Test-taking UI — two variants (not a theme gallery)

For the **test-taking screen** we build exactly **two** UIs, chosen per test via config — our tiny replacement for ThinkExam's template gallery:

1. **Standard government CBT interface** — the faithful real-exam screen (palette, server timer, section tabs, Save & Next / Mark for Review / Clear Response, per-question language). Used for **full-length mock tests** — the V1 focus.
2. **Generic test UI** — a lighter, modern test-taking screen for simpler types (daily tests, sectional/topic practice, quizzes) that don't need the full exam-hall replica. **Secondary — build only if time permits.** The CBT interface is the primary V1 deliverable; the generic UI is a nice-to-have add-on, never a blocker.

Which UI a test uses is a **config field**, not a separate build per exam. All IACE exam formats (SSC CGL/CHSL, IBPS/SBI Banking, RRB JE/NTPC/Group D, SI/Constable) share the **same** CBT interface; their differences are **config-level, not template-level:**

- **Sectional timing on/off + locked vs free section switching** — Banking prelims/mains use sectional timing with locked sections; SSC CGL Tier 1 is one timer, free navigation.
- **Optional on-screen calculator** — Banking Mains provides one; SSC does not.
- Section counts, question counts, and marking — all config.

So the CBT interface is **one** screen parameterized by config — no per-exam theme gallery. A meaningful time saver for the 45-day window.

(Separately, the student portal + admin **app shell** is its own single modern design system — see §5. That's distinct from these two test-taking UIs.)
