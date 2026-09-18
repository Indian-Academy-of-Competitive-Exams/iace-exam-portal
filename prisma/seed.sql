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
-- Ids are fixed UUID literals, not generated at runtime, so re-running this file is idempotent and
-- a developer can still recognise a row: the readable name lives in whatever name/code/stageKey
-- column the table already carries.
--
-- The full catalog (4 courses, 43 exams, 122 stages, 30 default configs) lives in
-- prisma/seed.catalog.sql — generated from Exam_Pattern_Base_Configurations.xlsx and run
-- right after this file by `pnpm db:seed`. This file keeps the hand-curated rows: the
-- super admin, the branches, and the SSC CGL default config the app was first built on.
-- See docs/seed-exam-catalog.md for the mapping decisions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The first super admin.
--
-- Admins cannot self-register and nothing in the application creates one, so
-- without this row there is no way into the admin app at all. Every later admin
-- is created by this one.
-- ---------------------------------------------------------------------------
INSERT INTO "Admin" ("id", "email", "fullName", "isSuperAdmin", "isActive")
VALUES ('6559582c-1bf3-4482-aea2-ec69ddd5f505', 'developer@iace.co.in', 'Super Admin', true, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Branches.
--
-- ONLINE is the VIRTUAL branch, and the application cannot do without it.
-- A STANDARD series is the one kind gated by branch: AccessResolverService
-- reaches it only when the student's current branch is on the series' own
-- branchIds AND their enrolled courses include the course of its stage. FREE,
-- PROGRAM and EVENT series and an explicit StudentGrant carry no branch
-- condition at all, so a student with no branch still reaches those and only
-- STANDARD closes to them. Every ONLINE student sits here, and the admin
-- screens now lock their branch picker to this row.
--
-- It is a singleton and the code treats it as one — branchEditBlocker refuses
-- to rename or retire it, branchDeletionBlocker refuses to delete it, and
-- BranchesService.create refuses a second VIRTUAL row. Seeding it is therefore
-- the only comfortable way to bring it into existence, and the id is fixed so
-- support conversations and later seed passes can name it.
--
-- The rest are the coaching centres. Names are canonical
-- (packages/contracts/src/naming.ts): UPPERCASE, letters and digits,
-- single-spaced. The application normalises what an admin types; nothing
-- normalises a seed, so these are written correct.
--
-- The guard is Branch_name_live_key — UNIQUE (name) WHERE "deletedAt" IS NULL —
-- so a database that already has these rows under different ids keeps them and
-- this file adds nothing. New devices get the fixed ids below.
--
-- A branch a student still attends cannot be deleted, and a retired one takes
-- no new students, so removing a centre from this list does not remove it from
-- a database that already ran it. Retire it on the admin Branches screen.
-- ---------------------------------------------------------------------------
INSERT INTO "Branch" ("id", "name", "type", "isActive")
VALUES
  ('34739489-95f9-4c12-9c36-44a25f1590f5', 'ONLINE',        'VIRTUAL',  true),
  ('56b593cb-997a-402f-90c5-103a1718fda0', 'AMEERPET',      'PHYSICAL', true),
  ('5a92b9d8-9e66-461b-a3df-34c0c8ca3ef3', 'ANANTHAPUR',    'PHYSICAL', true),
  ('d55fcc74-76bd-4db2-a210-e0dfa5c5bf09', 'DILSUKHNAGAR',  'PHYSICAL', true),
  ('e1931c53-ccd1-428a-a9f6-ba4de960be05', 'KUKATPALLY',    'PHYSICAL', true),
  ('b3c7277f-2d43-4b11-ac84-85234696c58a', 'NELLORE',       'PHYSICAL', true),
  ('9657717c-1d77-4335-8424-9027b55708fa', 'RAJAHMUNDRY',   'PHYSICAL', true),
  ('b9ebe459-c727-4a48-8b38-a18543fc78f8', 'TIRUPATI',      'PHYSICAL', true),
  ('694625ba-8fb0-4d22-9aed-6fc3d8c951d8', 'VIJAYAWADA',    'PHYSICAL', true),
  ('edf7313e-7140-4785-b47b-2663e4993e34', 'VISAKHAPATNAM', 'PHYSICAL', true),
  ('6afe1d7c-c5f3-4f06-97a8-6b268d68c345', 'VIZIANAGARAM',  'PHYSICAL', true)
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
INSERT INTO "Exam" ("id", "course", "code", "name", "description")
VALUES ('e6e82193-acbb-465a-98fb-ac54cec1d64c', 'SSC', 'SSC CGL', 'Combined Graduate Level',
        'SSC Combined Graduate Level examination')
ON CONFLICT DO NOTHING;

INSERT INTO "ExamStage" ("id", "examId", "stageKey", "name", "order", "mode", "disposition")
VALUES
  ('7d09d6e1-2748-4c36-836b-fd0fc6d36d93', 'e6e82193-acbb-465a-98fb-ac54cec1d64c', 'SSC_CGL_T1', 'Tier 1', 1, 'CBT', 'CONDUCTED'),
  ('7cdf1dc2-202e-4996-91c5-cd6cd1f65be0', 'e6e82193-acbb-465a-98fb-ac54cec1d64c', 'SSC_CGL_T2', 'Tier 2', 2, 'CBT', 'PARTIAL')
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
  ('d980b343-efea-4225-9ba5-b84a2e42751b', 'GENERAL INTELLIGENCE AND REASONING', 'REASONING'),
  ('23056a18-679b-4288-b4fd-94309611d29b', 'GENERAL AWARENESS',                  'GENERAL_AWARENESS'),
  ('071fc04c-f7f0-4e4b-9987-eff387bc2a91', 'QUANTITATIVE APTITUDE',              'QUANTITATIVE_APTITUDE'),
  ('0ad32b99-23f6-41ff-8420-bfee20f91347', 'ENGLISH COMPREHENSION',              'ENGLISH')
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
  'db57045c-c58f-4fdd-a2cf-8fcbb6e4626f', '7d09d6e1-2748-4c36-836b-fd0fc6d36d93', 'SSC CGL Tier 1 — official pattern', true, 1, 100, 200.00,
  3600, 'COMPOSITE_FREE', 'FREE', 'CBT', 'DUAL',
  ARRAY['EN', 'HI']::"SupportedLanguage"[], true, true, false, 1
)
ON CONFLICT DO NOTHING;

INSERT INTO "BaseConfigSection" (
  "id", "baseConfigId", "name", "order", "subjectId",
  "questionCount", "marksPerQuestion", "negativeMarks", "mandatory", "meritOrQualifying"
)
VALUES
  ('52724cef-69bc-4457-96f4-240f97f14158', 'db57045c-c58f-4fdd-a2cf-8fcbb6e4626f', 'General Intelligence and Reasoning', 1, 'd980b343-efea-4225-9ba5-b84a2e42751b', 25, 2.00, 0.50, true, 'MERIT'),
  ('abc5aae1-fe7e-49e0-b4c5-e19618247fff', 'db57045c-c58f-4fdd-a2cf-8fcbb6e4626f', 'General Awareness',                  2, '23056a18-679b-4288-b4fd-94309611d29b', 25, 2.00, 0.50, true, 'MERIT'),
  ('4d97e439-869e-4f9e-9b77-ab46690dbbe3', 'db57045c-c58f-4fdd-a2cf-8fcbb6e4626f', 'Quantitative Aptitude',              3, '071fc04c-f7f0-4e4b-9987-eff387bc2a91', 25, 2.00, 0.50, true, 'MERIT'),
  ('8d3b4761-cfe7-4378-9095-711878ef99bd', 'db57045c-c58f-4fdd-a2cf-8fcbb6e4626f', 'English Comprehension',              4, '0ad32b99-23f6-41ff-8420-bfee20f91347', 25, 2.00, 0.50, true, 'MERIT')
ON CONFLICT DO NOTHING;
