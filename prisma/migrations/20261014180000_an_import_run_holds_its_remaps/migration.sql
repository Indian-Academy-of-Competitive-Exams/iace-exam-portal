-- A question import run can read a sheet value the bank lacks (a subject, a topic, a difficulty)
-- as one it holds, chosen in the preview. Held on the run, never on the sheet or the bank.
ALTER TABLE "ImportLog" ADD COLUMN "remaps" JSONB;
