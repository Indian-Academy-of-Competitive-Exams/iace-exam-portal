-- A test declares, once, where its questions come from.
--
-- FRAMED means a typist writes them for this test and a proof-reader reads them; PICKED means the
-- admin picks them from the bank and a proof-reader reads what was picked. Null means the choice
-- has not been made yet, which is where every existing test starts and stays until somebody says.
--
-- Nullable on purpose rather than defaulted: a default would answer the question for every test
-- already in the table, and the whole point of the column is that a human answers it once. The
-- service refuses a second write, so the irreversibility is policy, not a constraint — a super
-- admin has to be able to correct a wrong choice.
--
-- Pure DDL: one new enum, one new nullable column. No data moves.

-- CreateEnum
CREATE TYPE "PaperSource" AS ENUM ('FRAMED', 'PICKED');

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "paperSource" "PaperSource";
