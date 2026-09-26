-- Three indexes whose columns are a prefix of a longer index on the same table.
--
-- A btree answers a lookup on any leading subset of its columns, so an index on (a) is redundant
-- beside one on (a, b): the longer one serves both, and the shorter one is a second entry to
-- maintain on every insert and update of that table for nothing. Unique counts as an index here --
-- `QuestionAssignment`'s and `Test`'s cover is a UNIQUE, which is still a btree.
--
--   ExamStage (examId)          -> ExamStage (examId, order)
--   QuestionAssignment (testId) -> UNIQUE (testId, baseConfigSectionId, role)
--   Test (testSeriesId)         -> UNIQUE (testSeriesId, lower(title))
--
-- The third cover is an expression index and still applies: `lower(title)` is the SECOND column, so
-- a lookup or a sort on `testSeriesId` alone reads its leading column as any prefix scan would.
--
-- Not dropped, though the same check named them: `BaseConfig_pkey` and `Test_pkey` sit beside the
-- composite uniques that back composite foreign keys. A primary key is not a tuning decision.
--
-- 158 indexes across the schema before this. The rest of that number is a question for
-- `pg_stat_user_indexes.idx_scan` on a database that has served real traffic -- see
-- `scripts/index-usage.mjs`; a test suite plans too little data to tell a used index from an
-- unused one.

-- DropIndex
DROP INDEX "ExamStage_examId_idx";

-- DropIndex
DROP INDEX "QuestionAssignment_testId_idx";

-- DropIndex
DROP INDEX "Test_testSeriesId_idx";
