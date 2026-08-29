-- Exam.code is documented as canonical -- UPPERCASE, letters and digits, single
-- spaced -- and examCodeSchema in packages/contracts enforces exactly that on
-- every write through the admin API. The seeded catalog never went through that
-- schema: it was inserted by raw SQL and carries underscores (SSC_CGL), which
-- CANONICAL_NAME_PATTERN rejects. So the 43 seeded exams could not be saved from
-- the exam form, and the student importer -- which canonicalises a sheet cell to
-- spaces before matching -- failed every enrolment row with "No such exam code".
--
-- This replaces every underscore in Exam.code with a space, and rewrites
-- Student.enrolledExams element-wise in the SAME transaction. That lockstep is
-- the whole point: enrolledExams holds denormalised copies of Exam.code with no
-- foreign key behind them, and the reach query joins the two as strings
-- (access-resolver.service.ts). Moving one without the other would silently cut
-- every exam-route student off from every test series -- no error, no log, just
-- an empty catalog.
--
-- Deliberately NOT touched:
--   * ExamStage.stageKey (SSC_CGL_T1) -- a separate namespace that stageKeySchema
--     actively converts spaces INTO underscores for, because the exam-pattern
--     workbook and every seed script address a stage by it.
--   * The ExamFamily enum (AP_TS_POLICE) -- a Postgres enum label, not a code.
--
-- Verified before writing: every code matches ^[A-Z0-9_]+$, so the replacement
-- lands exactly on canonical form, and no two codes collide once their
-- underscores become spaces -- which matters because Exam.code is UNIQUE and a
-- collision would abort mid-update.

UPDATE "Exam"
SET "code" = replace("code", '_', ' ')
WHERE "code" <> replace("code", '_', ' ');

UPDATE "Student"
SET "enrolledExams" = ARRAY(SELECT replace(x, '_', ' ') FROM unnest("enrolledExams") AS x)
WHERE "enrolledExams" <> ARRAY(SELECT replace(x, '_', ' ') FROM unnest("enrolledExams") AS x);
