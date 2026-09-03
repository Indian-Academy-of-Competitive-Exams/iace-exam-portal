-- A series is STANDARD, FREE, PROGRAM or EVENT.
--
-- SCHOLARSHIP becomes EVENT. It is a rename, not a replacement: a scholarship
-- test WAS an event -- an ad-hoc sitting, reached by nothing but a grant, open
-- to people who are not IACE students. Naming it EVENT is what lets the same
-- row carry an entrance exam, a scholarship round and an open mock day without
-- three kinds that behave identically. RENAME VALUE rewrites the catalog entry
-- in place, so every series keeps the kind it had and no row is touched.
--
-- PROGRAM is new, and nothing carries it yet. Today a program-only series is a
-- STANDARD row with a programCode set, which the resolver reads as program-only
-- because the exam arm insists on programCode IS NULL. Task 4 turns those rows
-- into PROGRAM rows; this migration only makes the word available.
--
-- ADD VALUE and RENAME VALUE are separated from every write of them because
-- Postgres refuses to use an enum value in the transaction that added it, and
-- Prisma runs each migration in one transaction.

ALTER TYPE "TestSeriesKind" RENAME VALUE 'SCHOLARSHIP' TO 'EVENT';

ALTER TYPE "TestSeriesKind" ADD VALUE 'PROGRAM';
