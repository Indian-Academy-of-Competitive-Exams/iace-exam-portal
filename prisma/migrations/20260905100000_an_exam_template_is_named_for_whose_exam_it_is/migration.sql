-- ExamTemplate's values are renamed for the exam they imitate, not for how they feel.
--
-- COMFORTABLE and STRICT described the skin -- roomy versus dense. The people choosing one are the
-- people who ran the exam centre, and they do not pick a screen by how roomy it is; they pick the one
-- that looks like the board's own CBT. So the values say whose exam it is, and the labels on screen say
-- the same words the constants do, which is the repo's rule for a label.
--
-- RENAME VALUE, not a type rewrite: the labels change in place and every row keeps the value it had.
-- BaseConfig.examTemplate and Test.examTemplate both carry it, and neither is rewritten or re-defaulted
-- beyond the default's own name.

ALTER TYPE "ExamTemplate" RENAME VALUE 'COMFORTABLE' TO 'DEFAULT';
ALTER TYPE "ExamTemplate" RENAME VALUE 'STRICT' TO 'SSC_RAILWAYS';

ALTER TABLE "BaseConfig" ALTER COLUMN "examTemplate" SET DEFAULT 'DEFAULT';
ALTER TABLE "Test" ALTER COLUMN "examTemplate" SET DEFAULT 'DEFAULT';
