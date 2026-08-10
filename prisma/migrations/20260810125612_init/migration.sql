-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_MCQ');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestUi" AS ENUM ('CBT', 'GENERIC');

-- CreateEnum
CREATE TYPE "LanguageMode" AS ENUM ('SINGLE', 'DUAL');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PaperQuestionStatus" AS ENUM ('ACTIVE', 'DROPPED', 'BONUS');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnswerState" AS ENUM ('NOT_VISITED', 'NOT_ANSWERED', 'ANSWERED', 'MARKED_REVIEW', 'ANSWERED_MARKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TEST_ASSIGNED', 'RESULT_READY', 'GENERIC');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "fullName" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "gender" "Gender",
    "dob" DATE,
    "photoUrl" TEXT,
    "aadhaarUrl" TEXT,
    "panUrl" TEXT,
    "educationDetails" JSONB,
    "pastExamHistory" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "questionCode" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'SINGLE_MCQ',
    "subjectId" TEXT NOT NULL,
    "topicId" TEXT,
    "difficulty" "DifficultyLevel" NOT NULL,
    "defaultMarks" DECIMAL(6,2),
    "defaultNegativeMarks" DECIMAL(6,2),
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "content" JSONB NOT NULL,
    "stemHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "text" JSONB NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,

    CONSTRAINT "ExamType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseConfig" (
    "id" TEXT NOT NULL,
    "examTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "sectionalTiming" BOOLEAN NOT NULL DEFAULT false,
    "lockedSectionSwitching" BOOLEAN NOT NULL DEFAULT false,
    "optionalSectionCount" INTEGER,
    "calculatorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultTestUi" "TestUi" NOT NULL DEFAULT 'CBT',
    "languageMode" "LanguageMode" NOT NULL DEFAULT 'SINGLE',
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "marksPerQuestion" DECIMAL(6,2),
    "negativeMarks" DECIMAL(6,2),
    "defaultDifficultyMix" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaseConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseConfigSection" (
    "id" TEXT NOT NULL,
    "baseConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "subjectId" TEXT,
    "questionCount" INTEGER NOT NULL,
    "marksPerQuestion" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL,
    "durationSec" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "difficultyMix" JSONB,

    CONSTRAINT "BaseConfigSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "examTypeId" TEXT,
    "baseConfigId" TEXT,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "testUi" "TestUi" NOT NULL DEFAULT 'CBT',
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "sectionalTiming" BOOLEAN NOT NULL DEFAULT false,
    "lockedSectionSwitching" BOOLEAN NOT NULL DEFAULT false,
    "optionalSectionCount" INTEGER,
    "calculatorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "languageMode" "LanguageMode" NOT NULL DEFAULT 'SINGLE',
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "publishStartAt" TIMESTAMP(3),
    "publishEndAt" TIMESTAMP(3),
    "entryCutoffSec" INTEGER,
    "extraTimeSec" INTEGER,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMP(3),
    "shareSlug" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSection" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "subjectId" TEXT,
    "questionCount" INTEGER NOT NULL,
    "marksPerQuestion" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL,
    "durationSec" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "difficultyMix" JSONB,

    CONSTRAINT "TestSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testSectionId" TEXT,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL,
    "status" "PaperQuestionStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "PaperQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3),
    "shuffleSeed" INTEGER NOT NULL,
    "resumeCount" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "sectionState" JSONB,
    "score" DECIMAL(8,2),
    "correctCount" INTEGER,
    "wrongCount" INTEGER,
    "unattemptedCount" INTEGER,
    "sectionScores" JSONB,
    "rank" INTEGER,
    "percentile" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptAnswer" (
    "attemptId" TEXT NOT NULL,
    "paperQuestionId" TEXT NOT NULL,
    "selectedOptionId" TEXT,
    "state" "AnswerState" NOT NULL DEFAULT 'NOT_VISITED',
    "timeSpentSec" INTEGER NOT NULL DEFAULT 0,
    "languageViewed" TEXT,
    "isCorrect" BOOLEAN,
    "marksAwarded" DECIMAL(6,2),
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("attemptId","paperQuestionId")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSeries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "testId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TestStudentAccess" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TestStudentAccess_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AdminToPage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AdminToPage_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TestToTestSeries" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TestToTestSeries_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_GroupToStudent" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GroupToStudent_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TestGroupAccess" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TestGroupAccess_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_mobile_key" ON "Student"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Page_code_key" ON "Page"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_studentId_key" ON "StudentProfile"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_subjectId_name_key" ON "Topic"("subjectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Question_questionCode_key" ON "Question"("questionCode");

-- CreateIndex
CREATE INDEX "Question_subjectId_difficulty_status_idx" ON "Question"("subjectId", "difficulty", "status");

-- CreateIndex
CREATE INDEX "Question_topicId_idx" ON "Question"("topicId");

-- CreateIndex
CREATE INDEX "Question_stemHash_idx" ON "Question"("stemHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_position_key" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ExamType_name_key" ON "ExamType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExamType_code_key" ON "ExamType"("code");

-- CreateIndex
CREATE INDEX "BaseConfig_examTypeId_idx" ON "BaseConfig"("examTypeId");

-- CreateIndex
CREATE INDEX "BaseConfigSection_subjectId_idx" ON "BaseConfigSection"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfigSection_baseConfigId_order_key" ON "BaseConfigSection"("baseConfigId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Test_shareSlug_key" ON "Test"("shareSlug");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE INDEX "Test_publishStartAt_publishEndAt_idx" ON "Test"("publishStartAt", "publishEndAt");

-- CreateIndex
CREATE INDEX "Test_examTypeId_idx" ON "Test"("examTypeId");

-- CreateIndex
CREATE INDEX "TestSection_subjectId_idx" ON "TestSection"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSection_testId_order_key" ON "TestSection"("testId", "order");

-- CreateIndex
CREATE INDEX "PaperQuestion_questionId_idx" ON "PaperQuestion"("questionId");

-- CreateIndex
CREATE INDEX "PaperQuestion_testSectionId_idx" ON "PaperQuestion"("testSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_questionId_key" ON "PaperQuestion"("testId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_order_key" ON "PaperQuestion"("testId", "order");

-- CreateIndex
CREATE INDEX "Attempt_studentId_idx" ON "Attempt"("studentId");

-- CreateIndex
CREATE INDEX "Attempt_testId_status_idx" ON "Attempt"("testId", "status");

-- CreateIndex
CREATE INDEX "Attempt_testId_score_idx" ON "Attempt"("testId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_testId_studentId_key" ON "Attempt"("testId", "studentId");

-- CreateIndex
CREATE INDEX "AttemptAnswer_paperQuestionId_idx" ON "AttemptAnswer"("paperQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "Notification_studentId_isRead_idx" ON "Notification"("studentId", "isRead");

-- CreateIndex
CREATE INDEX "_TestStudentAccess_B_index" ON "_TestStudentAccess"("B");

-- CreateIndex
CREATE INDEX "_AdminToPage_B_index" ON "_AdminToPage"("B");

-- CreateIndex
CREATE INDEX "_TestToTestSeries_B_index" ON "_TestToTestSeries"("B");

-- CreateIndex
CREATE INDEX "_GroupToStudent_B_index" ON "_GroupToStudent"("B");

-- CreateIndex
CREATE INDEX "_TestGroupAccess_B_index" ON "_TestGroupAccess"("B");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfig" ADD CONSTRAINT "BaseConfig_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "ExamType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "ExamType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_testSectionId_fkey" FOREIGN KEY ("testSectionId") REFERENCES "TestSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_paperQuestionId_fkey" FOREIGN KEY ("paperQuestionId") REFERENCES "PaperQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuestionOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestStudentAccess" ADD CONSTRAINT "_TestStudentAccess_A_fkey" FOREIGN KEY ("A") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestStudentAccess" ADD CONSTRAINT "_TestStudentAccess_B_fkey" FOREIGN KEY ("B") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdminToPage" ADD CONSTRAINT "_AdminToPage_A_fkey" FOREIGN KEY ("A") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdminToPage" ADD CONSTRAINT "_AdminToPage_B_fkey" FOREIGN KEY ("B") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestToTestSeries" ADD CONSTRAINT "_TestToTestSeries_A_fkey" FOREIGN KEY ("A") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestToTestSeries" ADD CONSTRAINT "_TestToTestSeries_B_fkey" FOREIGN KEY ("B") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupToStudent" ADD CONSTRAINT "_GroupToStudent_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupToStudent" ADD CONSTRAINT "_GroupToStudent_B_fkey" FOREIGN KEY ("B") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestGroupAccess" ADD CONSTRAINT "_TestGroupAccess_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TestGroupAccess" ADD CONSTRAINT "_TestGroupAccess_B_fkey" FOREIGN KEY ("B") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
