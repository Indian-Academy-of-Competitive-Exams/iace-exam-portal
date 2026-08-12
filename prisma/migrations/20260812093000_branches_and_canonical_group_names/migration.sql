-- Branches become a table, and group names become canonical.
--
-- `Group.branch` was free text, which is how one centre ends up spelled three
-- ways, and `Group.name` was globally unique, which forced two branches running
-- the same batch to invent different names for it. Both are replaced: a group
-- now points at a row in `Branch`, and its name is unique only within that
-- branch.
--
-- Existing groups are DELETED rather than migrated. Their names do not meet the
-- new canonical rule, their free-text branches do not map cleanly onto rows, and
-- this runs before the platform carries real enrolment. Students survive; their
-- memberships do not, so every student must be put back into a group.

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- The one branch the system itself depends on: groups that belong to no
-- physical centre. Created here rather than in the seed so it exists in every
-- environment the moment the schema does, including a production deploy that
-- never runs a seed. Fixed id so re-running against a restored dump is a no-op.
INSERT INTO "Branch" ("id", "name", "isGlobal", "isActive")
VALUES ('brnchglobal000000000000', 'GLOBAL', true, true)
ON CONFLICT ("name") DO NOTHING;

-- Clear the old groups. The implicit M:N rows cascade from these deletes.
DELETE FROM "Group";

-- DropIndex
DROP INDEX "Group_name_key";

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "branch",
ADD COLUMN     "branchId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Group_branchId_idx" ON "Group"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_branchId_name_key" ON "Group"("branchId", "name");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
