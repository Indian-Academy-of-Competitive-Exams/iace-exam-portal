-- A series carried a switch of its own, `isEnabled`, beside the status every test
-- already has. Two switches decided one thing: a test reached a student only when
-- its series was on AND the test itself was ACTIVE. The series one read to the
-- people running it as a second place to forget, not as a gate, so it goes, and
-- the test's status is the one gate left.
--
-- Dropping the column alone would OPEN something. A test that is ACTIVE inside a
-- series that is switched off reaches nobody today, and would reach everybody its
-- series' kind reaches the moment the switch stopped being read. So the state
-- moves first: every such test becomes INACTIVE, which is what an admin gets by
-- unticking "Offered to students" on it, and is undone the same way.
--
-- `version` moves with it, as it does when the Offer step retires a test, so an
-- Offer step left open across this migration is refused rather than merged.
--
-- `announcedAt` is cleared on the same rows. The opening sweep stamps it once it
-- has told whoever a test reaches, and for a test in a switched-off series that
-- was nobody: the stamp is there and no student was ever told. Left in place, a
-- test stood down here and offered again later would open in silence, because
-- the sweep only speaks about tests with no stamp. Clearing it cannot tell
-- anybody twice: a notice is keyed `test-open:<test id>` per student, and the
-- unique index behind that key lands it once however often the sweep runs.
-- DRAFT and INACTIVE tests are left alone: neither reaches anybody either way.
-- Nothing else reads the column: no index, CHECK, trigger or function names it.

UPDATE "Test" t
SET "status" = 'INACTIVE',
    "announcedAt" = NULL,
    "version" = t."version" + 1,
    "updatedAt" = now()
FROM "TestSeries" s
WHERE s."id" = t."testSeriesId"
  AND NOT s."isEnabled"
  AND t."status" = 'ACTIVE';

ALTER TABLE "TestSeries" DROP COLUMN "isEnabled";
