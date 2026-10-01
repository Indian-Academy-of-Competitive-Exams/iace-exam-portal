-- Two additions, both on the question bank.
--
-- 1. `Question.stemHash` becomes UNIQUE instead of merely indexed.
--
-- `assertNotDuplicate` reads the hash and refuses a repeat with a message naming the question the
-- stem is already on — a good refusal, and the one an admin should normally see. But it reads
-- OUTSIDE the write transaction, so two commits racing on the same stem both miss and both insert,
-- and the bank keeps the duplicate the check exists to prevent. The pre-check stays; this is the
-- backstop under it.
--
-- The trade, stated because it is real: a racing import now fails with a unique violation rather
-- than silently landing a duplicate. The question importer writes its rows inside one transaction,
-- so the losing commit aborts whole. That is recoverable and loud — the run closes FAILED, and
-- re-running re-plans the sheet, by which point the winning row makes the duplicate a row the
-- importer classifies and skips. A silent duplicate in the bank is neither.
--
-- The column is nullable and Postgres permits many NULLs under a unique index, so questions without
-- a hash — the ones awaiting the rehash worker — are unaffected.
--
-- If this migration fails on a deploy, the database already holds duplicate stems. Do not weaken
-- the constraint: find them with
--   SELECT "stemHash", count(*) FROM "Question" WHERE "stemHash" IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;
-- and merge or archive the repeats first. Checked before writing this: zero duplicate groups.
--
-- 2. `PaperQuestion` gains `(testId, baseConfigSectionId)`.
--
-- The authoring queue counts a section's rows per test, once for the paper and once for the
-- unchecked, over every section on a page. `testId` is a usable prefix of `@@unique([testId,
-- order])`, so these were never unindexed — but they read a whole paper's entries and filter the
-- section out of them. The index costs nothing at runtime: `PaperQuestion` is written while a paper
-- is built and frozen by the sat guards once anybody sits it, so there is no steady write to
-- amplify.

DROP INDEX "Question_stemHash_idx";
CREATE UNIQUE INDEX "Question_stemHash_key" ON "Question"("stemHash");

CREATE INDEX "PaperQuestion_testId_baseConfigSectionId_idx" ON "PaperQuestion"("testId", "baseConfigSectionId");
