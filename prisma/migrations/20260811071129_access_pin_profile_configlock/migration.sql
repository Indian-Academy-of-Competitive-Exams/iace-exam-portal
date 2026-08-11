/*
  Warnings:

  - You are about to drop the `_TestGroupAccess` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_TestStudentAccess` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_TestGroupAccess" DROP CONSTRAINT "_TestGroupAccess_A_fkey";

-- DropForeignKey
ALTER TABLE "_TestGroupAccess" DROP CONSTRAINT "_TestGroupAccess_B_fkey";

-- DropForeignKey
ALTER TABLE "_TestStudentAccess" DROP CONSTRAINT "_TestStudentAccess_A_fkey";

-- DropForeignKey
ALTER TABLE "_TestStudentAccess" DROP CONSTRAINT "_TestStudentAccess_B_fkey";

-- AlterTable
ALTER TABLE "BaseConfig" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "preTestReady" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "motherName" TEXT;

-- DropTable
DROP TABLE "_TestGroupAccess";

-- DropTable
DROP TABLE "_TestStudentAccess";

-- CreateTable
CREATE TABLE "_GroupToTestSeries" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GroupToTestSeries_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_GroupToTestSeries_B_index" ON "_GroupToTestSeries"("B");

-- AddForeignKey
ALTER TABLE "_GroupToTestSeries" ADD CONSTRAINT "_GroupToTestSeries_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupToTestSeries" ADD CONSTRAINT "_GroupToTestSeries_B_fkey" FOREIGN KEY ("B") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
