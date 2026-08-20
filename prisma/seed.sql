-- ===========================================================================
-- Seed — the rows the platform cannot start without.
--
-- Pure SQL and idempotent: every statement is guarded, so running it against a
-- populated database changes nothing. `pnpm db:seed` runs it through
-- `prisma db execute`, and it is deliberately NOT wired to prisma's seed hook,
-- so a `migrate reset` never quietly recreates rows somebody meant to be rid of.
--
-- The guards name no arbiter, deliberately. `ON CONFLICT (col)` absorbs a
-- conflict on that one index and raises on any other, and these rows can
-- collide on more than one: a config carries a partial unique on
-- ("examStageId") WHERE "isDefault" as well as its primary key, so a seed
-- re-run after an admin has promoted their own default fails on whichever
-- index the arbiter did not name. Bare DO NOTHING means "this row already
-- exists in some form — leave it alone", which is the whole intent.
--
-- Ids are stable, human-readable strings rather than cuids. These rows are
-- referenced from documentation, from support conversations and from the next
-- seed pass, and a generated id would make each of those a lookup.
--
-- STILL OUTSTANDING: the full catalog is 4 families, 43 exams and 122 stages,
-- from Exam_Pattern_Base_Configurations.xlsx. Neither the workbook nor the
-- coverage pass that assigns each stage its disposition is in this repo yet, so
-- this seeds only SSC CGL — the exam the default config below belongs to.
-- Adding the rest is more rows in the same shape.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The first super admin.
--
-- Admins cannot self-register and nothing in the application creates one, so
-- without this row there is no way into the admin app at all. Every later admin
-- is created by this one.
-- ---------------------------------------------------------------------------
INSERT INTO "Admin" ("id", "email", "fullName", "isSuperAdmin", "isActive", "allBranches")
VALUES ('admin_root', 'developer@iace.co.in', 'Super Admin', true, true, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Exam taxonomy — SSC CGL.
--
-- Exam.code is what Student.enrolledExams holds, so it must never be reused for
-- a different exam. stageKey is the same promise one level down.
--
-- Two tiers, not four. The 2022 revamp abolished the descriptive Tier 3 and the
-- DEST/CPT Tier 4 as separate tiers; the skill test is now a module inside
-- Tier 2. Every cycle from 2022 on is Tier 1 + Tier 2.
--
-- Tier 2 is PARTIAL rather than CONDUCTED because it is a compound paper: its
-- objective modules can be sat as a mock, and the DEST typing module cannot.
-- ---------------------------------------------------------------------------
INSERT INTO "Exam" ("id", "family", "code", "name", "description")
VALUES ('exam_ssc_cgl', 'SSC', 'SSC_CGL', 'Combined Graduate Level',
        'SSC Combined Graduate Level examination')
ON CONFLICT DO NOTHING;

INSERT INTO "ExamStage" ("id", "examId", "stageKey", "name", "order", "mode", "disposition")
VALUES
  ('stage_ssc_cgl_t1', 'exam_ssc_cgl', 'SSC_CGL_T1', 'Tier 1', 1, 'CBT', 'CONDUCTED'),
  ('stage_ssc_cgl_t2', 'exam_ssc_cgl', 'SSC_CGL_T2', 'Tier 2', 2, 'CBT', 'PARTIAL')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Subjects the Tier 1 sections draw from.
--
-- A section's subject is what makes per-subject analytics possible, so the
-- default config names one for each of its four sections rather than leaving
-- them null and rolling every question up as "unclassified".
-- ---------------------------------------------------------------------------
INSERT INTO "Subject" ("id", "name", "code")
VALUES
  ('subject_reasoning',    'GENERAL INTELLIGENCE AND REASONING', 'REASONING'),
  ('subject_gk',           'GENERAL AWARENESS',                  'GENERAL_AWARENESS'),
  ('subject_quantitative', 'QUANTITATIVE APTITUDE',              'QUANTITATIVE_APTITUDE'),
  ('subject_english',      'ENGLISH COMPREHENSION',              'ENGLISH')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- SSC CGL Tier 1 — the stage's official pattern.
--
-- isDefault, so it is the config a new test starts from; an admin who wants a
-- different shape clones it rather than editing it. It locks at the first
-- finalize of any test built from it.
--
-- The pattern: four sections of 25 questions at 2 marks, 100 questions and 200
-- marks in one 60-minute sitting, 0.50 deducted per wrong answer, free movement
-- between sections. Both languages render together — SSC CGL is a dual-language
-- paper, and the student does not choose one.
--
-- totalQuestions and totalMarks are the display cache the model asks for, and
-- they are the sums of the sections below; the test asserts they agree.
-- ---------------------------------------------------------------------------
INSERT INTO "BaseConfig" (
  "id", "examStageId", "name", "isDefault", "version", "totalQuestions", "totalMarks",
  "durationSec", "timerTemplate", "navigation", "defaultTestUi", "languageMode",
  "languages", "shuffleQuestions", "shuffleOptions", "calculatorEnabled", "scoringVersion"
)
VALUES (
  'config_ssc_cgl_t1', 'stage_ssc_cgl_t1', 'SSC CGL Tier 1 — official pattern', true, 1, 100, 200.00,
  3600, 'COMPOSITE_FREE', 'FREE', 'CBT', 'DUAL',
  ARRAY['EN', 'HI']::"SupportedLanguage"[], true, true, false, 1
)
ON CONFLICT DO NOTHING;

INSERT INTO "BaseConfigSection" (
  "id", "baseConfigId", "name", "order", "subjectId",
  "questionCount", "marksPerQuestion", "negativeMarks", "mandatory", "meritOrQualifying"
)
VALUES
  ('section_ssc_cgl_t1_reasoning',    'config_ssc_cgl_t1', 'General Intelligence and Reasoning', 1, 'subject_reasoning',    25, 2.00, 0.50, true, 'MERIT'),
  ('section_ssc_cgl_t1_gk',           'config_ssc_cgl_t1', 'General Awareness',                  2, 'subject_gk',           25, 2.00, 0.50, true, 'MERIT'),
  ('section_ssc_cgl_t1_quantitative', 'config_ssc_cgl_t1', 'Quantitative Aptitude',              3, 'subject_quantitative', 25, 2.00, 0.50, true, 'MERIT'),
  ('section_ssc_cgl_t1_english',      'config_ssc_cgl_t1', 'English Comprehension',              4, 'subject_english',      25, 2.00, 0.50, true, 'MERIT')
ON CONFLICT DO NOTHING;
