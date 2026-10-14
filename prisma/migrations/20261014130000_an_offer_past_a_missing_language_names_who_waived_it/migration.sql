-- An admin may offer a paper whose questions lack a language its config is sat in. The offer
-- records who waived the check and when, so the test carries the name for as long as it exists.
-- Both or neither: a name without a time, or a time without a name, says nothing anyone can use.
ALTER TABLE "Test" ADD COLUMN "languageWaivedAt" TIMESTAMPTZ(3),
ADD COLUMN "languageWaivedById" UUID;

ALTER TABLE "Test" ADD CONSTRAINT "Test_languageWaivedById_fkey" FOREIGN KEY ("languageWaivedById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Test" ADD CONSTRAINT "Test_language_waiver_whole"
  CHECK (("languageWaivedById" IS NULL) = ("languageWaivedAt" IS NULL));
