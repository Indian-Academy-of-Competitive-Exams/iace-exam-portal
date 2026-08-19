-- Group state, and the one row this migration still needs to create.
--
-- The VIRTUAL branch already exists on every database this repo can produce:
-- 20260812093000 creates it as 'brnchglobal000000000000' / GLOBAL, and
-- 20260817120000 sets its type to VIRTUAL. So there is nothing to insert there —
-- only a rename, to the name docs/04 gives it: the branch every online student
-- sits in. It runs here, in a migration, because `branchEditBlocker` refuses to
-- rename a virtual branch through the UI, on purpose — this is the only path
-- left that can do it. Guarded on type AND name so a second run touches nothing;
-- also guarded on the target name being free, since `Branch.name` is unique and
-- a hand-created "ONLINE" branch would otherwise turn this into a failed deploy
-- instead of a no-op.
--
-- The Group seed IS still needed: nothing else creates the all-students group.
-- It is guarded on TYPE rather than id — what must be unique is "one
-- all-students group", not a literal id.

ALTER TABLE "Group" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "Group" ("id","name","type","isActive","createdAt","updatedAt")
SELECT 'grpglobal00000000000000', 'ALL STUDENTS', 'GLOBAL', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Group" WHERE "type" = 'GLOBAL');

UPDATE "Branch" SET "name" = 'ONLINE'
WHERE "type" = 'VIRTUAL'
  AND "name" = 'GLOBAL'
  AND NOT EXISTS (SELECT 1 FROM "Branch" WHERE "name" = 'ONLINE');
