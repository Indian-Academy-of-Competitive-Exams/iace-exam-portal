-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "subTopicId" TEXT;

-- CreateTable
CREATE TABLE "SubTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "SubTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SubTopicToTopic" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SubTopicToTopic_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubTopic_name_key" ON "SubTopic"("name");

-- CreateIndex
CREATE INDEX "_SubTopicToTopic_B_index" ON "_SubTopicToTopic"("B");

-- CreateIndex
CREATE INDEX "Question_subTopicId_idx" ON "Question"("subTopicId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subTopicId_fkey" FOREIGN KEY ("subTopicId") REFERENCES "SubTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubTopicToTopic" ADD CONSTRAINT "_SubTopicToTopic_A_fkey" FOREIGN KEY ("A") REFERENCES "SubTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubTopicToTopic" ADD CONSTRAINT "_SubTopicToTopic_B_fkey" FOREIGN KEY ("B") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
