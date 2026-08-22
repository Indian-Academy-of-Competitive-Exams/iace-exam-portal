-- A question now enters the bank UNREVIEWED.
--
-- The column defaulted to ACTIVE, so anything created without naming a status was
-- immediately drawable into a paper: a manual entry saved mid-typing, and every row of a
-- 400-row import, went live the moment it was written. There was no state between
-- "written" and "in circulation", so review could only ever happen after the fact.
--
-- DRAFT is that state. It already existed in the enum and nothing produced it.
--
-- Only the DEFAULT moves. Every row already in the table keeps the status it has, so no
-- question that is live today stops being live, and no paper changes shape. The two
-- creation paths — the admin form and the import commit — now send a status explicitly
-- and offer DRAFT first, so this default is the floor rather than the mechanism.

-- AlterTable
ALTER TABLE "Question" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
