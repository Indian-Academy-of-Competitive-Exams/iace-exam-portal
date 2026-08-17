-- Students, groups, branches and access — the target model in docs/04.
--
-- Written to PRESERVE existing rows. Three shapes move, and each one copies its
-- data across before the old column or table goes:
--   Branch.isGlobal          -> Branch.type = VIRTUAL
--   Group.branchId (single)  -> _BranchToGroup (many-to-many)
--   _GroupToStudent          -> Student.directGroupIds, plus the branch and the
--                               student type that membership implied
-- Every added NOT NULL column is added nullable, backfilled, then constrained.

-- CreateEnum
CREATE TYPE "StudentType" AS ENUM ('ONLINE', 'OFFLINE', 'NON_IACE');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('GLOBAL', 'EXAM', 'PROGRAM', 'SCHOLARSHIP', 'NON_IACE');

-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('PHYSICAL', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('INDIVIDUAL', 'SHEET', 'SCRIPT', 'SELF_SIGNUP');

-- CreateEnum
CREATE TYPE "AuditFeature" AS ENUM ('STUDENT', 'STUDENT_PROFILE', 'GROUP', 'BRANCH', 'ADMIN', 'QUESTION', 'TEST');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE', 'IMPORT');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'STUDENT', 'SCRIPT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: the branch that carried no address becomes the VIRTUAL one.
ALTER TABLE "Branch" ADD COLUMN     "type" "BranchType" NOT NULL DEFAULT 'PHYSICAL';

UPDATE "Branch" SET "type" = 'VIRTUAL' WHERE "isGlobal";

ALTER TABLE "Branch" DROP COLUMN "isGlobal";

-- AlterTable: Group gains its type and exam code. Backfilled as EXAM — every
-- group that exists is a batch sitting under a branch.
ALTER TABLE "Group" ADD COLUMN     "examType" TEXT,
ADD COLUMN     "type" "GroupType";

UPDATE "Group" SET "type" = 'EXAM' WHERE "type" IS NULL;

ALTER TABLE "Group" ALTER COLUMN "type" SET NOT NULL;

-- CreateTable: the branch catalog, populated from the single branch each group
-- had before it is dropped below.
CREATE TABLE "_BranchToGroup" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BranchToGroup_AB_pkey" PRIMARY KEY ("A","B")
);

INSERT INTO "_BranchToGroup" ("A", "B") SELECT "branchId", "id" FROM "Group";

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "baseBranchId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "createdVia" "ImportSource" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "currentBranchId" TEXT,
ADD COLUMN     "directGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enrolledExams" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "isTestBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "program" TEXT,
ADD COLUMN     "studentType" "StudentType";

-- Membership becomes an array on the student, and the branch it implied becomes
-- their branch. A student in a group at a physical centre attends it: OFFLINE.
UPDATE "Student" s
SET "directGroupIds" = m.group_ids,
    "baseBranchId" = m.branch_id,
    "currentBranchId" = m.branch_id,
    "studentType" = CASE WHEN m.at_a_centre THEN 'OFFLINE'::"StudentType" ELSE 'ONLINE'::"StudentType" END
FROM (
    SELECT gs."B" AS student_id,
           array_agg(DISTINCT gs."A") AS group_ids,
           -- A physical centre wins the tie: that is where they sit.
           (array_agg(g."branchId" ORDER BY b."type" ASC, b."name" ASC))[1] AS branch_id,
           bool_or(b."type" = 'PHYSICAL') AS at_a_centre
    FROM "_GroupToStudent" gs
    JOIN "Group" g ON g."id" = gs."A"
    JOIN "Branch" b ON b."id" = g."branchId"
    GROUP BY gs."B"
) m
WHERE s."id" = m.student_id;

UPDATE "Student" SET "studentType" = 'ONLINE' WHERE "studentType" IS NULL;

ALTER TABLE "Student" ALTER COLUMN "studentType" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "Group" DROP CONSTRAINT "Group_branchId_fkey";

-- DropForeignKey
ALTER TABLE "_GroupToStudent" DROP CONSTRAINT "_GroupToStudent_A_fkey";

-- DropForeignKey
ALTER TABLE "_GroupToStudent" DROP CONSTRAINT "_GroupToStudent_B_fkey";

-- DropIndex
DROP INDEX "Group_branchId_idx";

-- DropIndex
DROP INDEX "Group_branchId_name_key";

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "branchId";

-- DropTable
DROP TABLE "_GroupToStudent";

-- CreateTable
CREATE TABLE "BranchTestConfig" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "testSeriesId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchTestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "feature" "AuditFeature" NOT NULL,
    "source" "ImportSource" NOT NULL,
    "actorId" TEXT,
    "fileS3Key" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RowActionLog" (
    "id" TEXT NOT NULL,
    "feature" "AuditFeature" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "changed" JSONB,
    "importLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RowActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchTestConfig_testSeriesId_idx" ON "BranchTestConfig"("testSeriesId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchTestConfig_branchId_testSeriesId_key" ON "BranchTestConfig"("branchId", "testSeriesId");

-- CreateIndex
CREATE INDEX "ImportLog_feature_createdAt_idx" ON "ImportLog"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "RowActionLog_feature_entityId_actorId_createdAt_idx" ON "RowActionLog"("feature", "entityId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "RowActionLog_importLogId_idx" ON "RowActionLog"("importLogId");

-- CreateIndex
CREATE INDEX "_BranchToGroup_B_index" ON "_BranchToGroup"("B");

-- CreateIndex
CREATE INDEX "Group_type_idx" ON "Group"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Group_examType_name_key" ON "Group"("examType", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Student_externalRef_key" ON "Student"("externalRef");

-- CreateIndex
CREATE INDEX "Student_enrolledExams_idx" ON "Student" USING GIN ("enrolledExams");

-- CreateIndex
CREATE INDEX "Student_directGroupIds_idx" ON "Student" USING GIN ("directGroupIds");

-- CreateIndex
CREATE INDEX "Student_currentBranchId_idx" ON "Student"("currentBranchId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_baseBranchId_fkey" FOREIGN KEY ("baseBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_currentBranchId_fkey" FOREIGN KEY ("currentBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTestConfig" ADD CONSTRAINT "BranchTestConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTestConfig" ADD CONSTRAINT "BranchTestConfig_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RowActionLog" ADD CONSTRAINT "RowActionLog_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToGroup" ADD CONSTRAINT "_BranchToGroup_A_fkey" FOREIGN KEY ("A") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToGroup" ADD CONSTRAINT "_BranchToGroup_B_fkey" FOREIGN KEY ("B") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
