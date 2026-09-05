-- Question.createdById was a bare String: an admin id with nothing enforcing that an admin
-- of that id exists. Reading "who wrote this" meant a second query, and nothing stopped the
-- column drifting to an id that resolves to nobody.
--
-- It becomes a real relation so the draft list can name its author in the same read that
-- fetches the row, and so the author filter is a join rather than a lookup-then-filter.
--
-- The NULL-out has to come first. Adding a foreign key is all-or-nothing: one row pointing at
-- an admin that is not there and the whole ALTER fails, taking the deploy with it. Admins are
-- never hard-deleted today (deactivating flips isActive and drops the permission rows), so
-- this should match nothing — but "should" is not what a constraint accepts, and an id left
-- over from a seed, a restored dump or a hand-run script would be found only at deploy time.
--
-- NULL is the right landing place rather than a guess: the column is already nullable, and
-- "we no longer know who wrote this" is exactly what an unresolvable id means.

UPDATE "Question"
   SET "createdById" = NULL
 WHERE "createdById" IS NOT NULL
   AND "createdById" NOT IN (SELECT "id" FROM "Admin");

-- CreateIndex
CREATE INDEX "Question_createdById_idx" ON "Question"("createdById");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
