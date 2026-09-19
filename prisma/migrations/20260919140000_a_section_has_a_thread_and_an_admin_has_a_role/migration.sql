-- Two additive pieces of the authoring flow: the section thread, and a display role on Admin.
--
-- SectionComment is keyed on (testId, baseConfigSectionId) — the pair a QuestionAssignment
-- already keys on — rather than on an assignment row, because the typist and the proof-reader
-- hold two separate rows on the same section and share one thread. The FK is to Test alone
-- (CASCADE, so deleting a test takes its discussion with it); the section id rides along as a
-- plain column, since the composite FK to BaseConfigSection would need baseConfigId denormalised
-- for a value every write already proves by looking the assignment up.
--
-- Append-only by construction: nothing in the service updates or deletes a row, so the thread
-- reads as a record of what was said rather than as editable text.
--
-- THIS MIGRATION MOVES DATA. Admin.role lands with DEFAULT 'ADMIN', which is right for everyone
-- except the super admins — they would silently be labelled plain admins on every screen. The
-- backfill below fixes that, and from an empty database it matches no rows and proves nothing,
-- which is why it was run against a seeded copy instead. The role is DISPLAY ONLY: it presets the
-- permission checkboxes and labels the person, and no guard anywhere reads it. AdminFeaturePermission
-- stays the only thing authorisation consults.

BEGIN;

CREATE TYPE "AdminRole" AS ENUM ('TYPIST', 'PROOFREADER', 'ADMIN', 'SUPER_ADMIN');

ALTER TABLE "Admin" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';

UPDATE "Admin" SET "role" = 'SUPER_ADMIN' WHERE "isSuperAdmin";

CREATE TABLE "SectionComment" (
    "id" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "baseConfigSectionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SectionComment_testId_baseConfigSectionId_createdAt_idx" ON "SectionComment"("testId", "baseConfigSectionId", "createdAt");

ALTER TABLE "SectionComment" ADD CONSTRAINT "SectionComment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SectionComment" ADD CONSTRAINT "SectionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
