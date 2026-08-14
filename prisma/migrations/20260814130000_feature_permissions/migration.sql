/*
  Warnings:

  - You are about to drop the `Page` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_AdminToPage` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('READ', 'WRITE');

-- DropForeignKey
ALTER TABLE "_AdminToPage" DROP CONSTRAINT "_AdminToPage_A_fkey";

-- DropForeignKey
ALTER TABLE "_AdminToPage" DROP CONSTRAINT "_AdminToPage_B_fkey";

-- DropTable
DROP TABLE "Page";

-- DropTable
DROP TABLE "_AdminToPage";

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePermission" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL,
    "adminIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE INDEX "FeaturePermission_adminIds_idx" ON "FeaturePermission" USING GIN ("adminIds");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturePermission_featureId_level_key" ON "FeaturePermission"("featureId", "level");

-- AddForeignKey
ALTER TABLE "FeaturePermission" ADD CONSTRAINT "FeaturePermission_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
