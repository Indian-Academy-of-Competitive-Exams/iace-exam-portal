-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "DifficultyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SupportedLanguage" AS ENUM ('EN', 'HI', 'TE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_MCQ', 'TEXT_FIELD');

-- CreateEnum
CREATE TYPE "AnswerMode" AS ENUM ('NUMERIC', 'TEXT');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestUi" AS ENUM ('CBT', 'OMR', 'GENERIC', 'TYPING');

-- CreateEnum
CREATE TYPE "NavigationPolicy" AS ENUM ('FREE', 'FORWARD_ONLY');

-- CreateEnum
CREATE TYPE "LanguageMode" AS ENUM ('SINGLE', 'DUAL');

-- CreateEnum
CREATE TYPE "TimerTemplate" AS ENUM ('COMPOSITE_FREE', 'SECTIONAL_LOCKED', 'SESSION_MODULE_LOCKED', 'PER_ITEM_TIMED');

-- CreateEnum
CREATE TYPE "ExamFamily" AS ENUM ('SSC', 'RRB', 'BANKING', 'AP_TS_POLICE');

-- CreateEnum
CREATE TYPE "ExamMode" AS ENUM ('CBT', 'OMR', 'PSYCHOMETRIC', 'SKILL', 'PHYSICAL', 'INTERVIEW', 'DESCRIPTIVE');

-- CreateEnum
CREATE TYPE "MeritType" AS ENUM ('MERIT', 'QUALIFYING');

-- CreateEnum
CREATE TYPE "StageDisposition" AS ENUM ('CONDUCTED', 'PARTIAL', 'CATALOG_ONLY');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TestScope" AS ENUM ('FULL', 'MODULE', 'SECTIONAL', 'TOPIC');

-- CreateEnum
CREATE TYPE "EvaluationMode" AS ENUM ('RANKED', 'PRACTICE');

-- CreateEnum
CREATE TYPE "PaperBinding" AS ENUM ('FIXED', 'GENERATED');

-- CreateEnum
CREATE TYPE "DrawStrategy" AS ENUM ('RANDOM', 'NEWEST_FIRST', 'LEAST_SERVED', 'UNSEEN_FIRST');

-- CreateEnum
CREATE TYPE "PaperQuestionStatus" AS ENUM ('ACTIVE', 'DROPPED', 'BONUS');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnswerState" AS ENUM ('NOT_VISITED', 'NOT_ANSWERED', 'ANSWERED', 'MARKED_REVIEW', 'ANSWERED_MARKED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TEST_ASSIGNED', 'RESULT_READY', 'ENROLLMENT_ADDED', 'GRANT_ADDED', 'SERIES_UNLOCKED', 'GENERIC');

-- CreateEnum
CREATE TYPE "StudentType" AS ENUM ('ONLINE', 'OFFLINE', 'NON_IACE');

-- CreateEnum
CREATE TYPE "BranchType" AS ENUM ('PHYSICAL', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('INDIVIDUAL', 'SHEET', 'SCRIPT', 'SELF_SIGNUP');

-- CreateEnum
CREATE TYPE "UnlockMode" AS ENUM ('AUTO', 'REQUEST', 'ADMIN');

-- CreateEnum
CREATE TYPE "UnlockState" AS ENUM ('LOCKED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "UnlockRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "AuditFeature" AS ENUM ('STUDENT', 'STUDENT_PROFILE', 'GROUP', 'BRANCH', 'ADMIN', 'QUESTION', 'TEST', 'EXAM_TYPE', 'TAXONOMY_SUBJECT', 'TAXONOMY_TOPIC', 'TAXONOMY_SUB_TOPIC', 'FEATURE_PERMISSION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE', 'BLOCK', 'UNBLOCK', 'IMPORT');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'STUDENT', 'SCRIPT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "family" "ExamFamily" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamStage" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "mode" "ExamMode" NOT NULL DEFAULT 'CBT',
    "disposition" "StageDisposition" NOT NULL DEFAULT 'CONDUCTED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseConfig" (
    "id" TEXT NOT NULL,
    "examStageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "clonedFromId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "totalQuestions" INTEGER NOT NULL,
    "totalMarks" DECIMAL(8,2) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "timerTemplate" "TimerTemplate" NOT NULL DEFAULT 'COMPOSITE_FREE',
    "navigation" "NavigationPolicy" NOT NULL DEFAULT 'FREE',
    "optionalSectionCount" INTEGER,
    "defaultTestUi" "TestUi" NOT NULL DEFAULT 'CBT',
    "languageMode" "LanguageMode" NOT NULL DEFAULT 'SINGLE',
    "languages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "calculatorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "featureFlags" JSONB,
    "scoringVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaseConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseConfigModule" (
    "id" TEXT NOT NULL,
    "baseConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "durationSec" INTEGER,

    CONSTRAINT "BaseConfigModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseConfigSection" (
    "id" TEXT NOT NULL,
    "baseConfigId" TEXT NOT NULL,
    "moduleId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "subjectId" TEXT,
    "questionCount" INTEGER NOT NULL,
    "marksPerQuestion" DECIMAL(6,2) NOT NULL,
    "negativeMarks" DECIMAL(6,2) NOT NULL,
    "durationSec" INTEGER,
    "perQuestionSec" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "meritOrQualifying" "MeritType" NOT NULL DEFAULT 'MERIT',
    "qualifyingCutoff" DECIMAL(6,2),
    "difficultyMix" JSONB,

    CONSTRAINT "BaseConfigSection_pkey" PRIMARY KEY ("id")
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
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stemHash" TEXT,
    "fixedUseCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "options" JSONB,
    "answerKey" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "baseConfigId" TEXT NOT NULL,
    "examStageId" TEXT NOT NULL,
    "scope" "TestScope" NOT NULL DEFAULT 'FULL',
    "scopeRef" JSONB,
    "evaluationMode" "EvaluationMode" NOT NULL DEFAULT 'RANKED',
    "paperBinding" "PaperBinding" NOT NULL DEFAULT 'FIXED',
    "maxRetakes" INTEGER,
    "questionPoolFilter" JSONB,
    "drawStrategy" "DrawStrategy" NOT NULL DEFAULT 'RANDOM',
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperQuestion" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "baseConfigId" TEXT NOT NULL,
    "baseConfigSectionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
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
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "isGraded" BOOLEAN NOT NULL DEFAULT true,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "evaluatedAt" TIMESTAMPTZ(3),
    "shuffleSeed" INTEGER NOT NULL,
    "languages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "sectionState" JSONB,
    "score" DECIMAL(8,2),
    "correctCount" INTEGER,
    "wrongCount" INTEGER,
    "unattemptedCount" INTEGER,
    "sectionScores" JSONB,
    "lastRank" INTEGER,
    "lastPercentile" DECIMAL(5,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "paperQuestionId" TEXT,
    "questionVersionId" TEXT NOT NULL,
    "baseConfigSectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "selectedOptionId" TEXT,
    "typedAnswer" TEXT,
    "state" "AnswerState" NOT NULL DEFAULT 'NOT_VISITED',
    "timeSpentSec" INTEGER NOT NULL DEFAULT 0,
    "isCorrect" BOOLEAN,
    "marksAwarded" DECIMAL(6,2),
    "answeredAt" TIMESTAMPTZ(3),

    CONSTRAINT "AttemptQuestion_pkey" PRIMARY KEY ("attemptId","questionId")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "externalRef" TEXT,
    "studentType" "StudentType" NOT NULL,
    "enrolledFamilies" "ExamFamily"[] DEFAULT ARRAY[]::"ExamFamily"[],
    "programs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enrolledExams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentBranchId" TEXT,
    "pinHash" TEXT,
    "pinIsDefault" BOOLEAN NOT NULL DEFAULT true,
    "fullName" TEXT,
    "preferredLanguage" "SupportedLanguage" NOT NULL DEFAULT 'EN',
    "preTestReady" BOOLEAN NOT NULL DEFAULT false,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTestBlocked" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "motherName" TEXT,
    "fatherName" TEXT,
    "dob" DATE,
    "email" TEXT,
    "address" TEXT,
    "gender" "Gender",
    "photoUrl" TEXT,
    "aadhaarVerified" BOOLEAN NOT NULL DEFAULT false,
    "panVerified" BOOLEAN NOT NULL DEFAULT false,
    "tenthMarksheetUrl" TEXT,
    "educationDetails" JSONB,
    "pastExamHistory" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allBranches" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminBranch" (
    "adminId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "AdminBranch_pkey" PRIMARY KEY ("adminId","branchId")
);

-- CreateTable
CREATE TABLE "AdminFeaturePermission" (
    "adminId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL,

    CONSTRAINT "AdminFeaturePermission_pkey" PRIMARY KEY ("adminId","featureKey","level")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BranchType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSeries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "examStageId" TEXT,
    "programCode" TEXT,
    "sequentialTests" BOOLEAN NOT NULL DEFAULT false,
    "prerequisiteSeriesId" TEXT,
    "unlockMode" "UnlockMode" NOT NULL DEFAULT 'AUTO',
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSeriesTest" (
    "testSeriesId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "order" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "TestSeriesTest_pkey" PRIMARY KEY ("testSeriesId","testId")
);

-- CreateTable
CREATE TABLE "StudentGrant" (
    "studentId" TEXT NOT NULL,
    "testSeriesId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "StudentGrant_pkey" PRIMARY KEY ("studentId","testSeriesId")
);

-- CreateTable
CREATE TABLE "StudentSeriesUnlock" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "testSeriesId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentSeriesUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesUnlockRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "testSeriesId" TEXT NOT NULL,
    "status" "UnlockRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,

    CONSTRAINT "SeriesUnlockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchTestConfig" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "testSeriesId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "errors" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RowActionLog" (
    "id" TEXT NOT NULL,
    "feature" "AuditFeature" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "action" "AuditAction" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "changed" JSONB,
    "importLogId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RowActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedRollup" (
    "attemptId" TEXT NOT NULL,
    "rollupType" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedRollup_pkey" PRIMARY KEY ("attemptId","rollupType")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "testId" TEXT,
    "testSeriesId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentStat" (
    "studentId" TEXT NOT NULL,
    "testsAttempted" INTEGER NOT NULL DEFAULT 0,
    "testsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "sumScore" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sumPercentile" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "bestPercentile" DECIMAL(5,2),
    "totalAnswered" INTEGER NOT NULL DEFAULT 0,
    "totalCorrect" INTEGER NOT NULL DEFAULT 0,
    "totalWrong" INTEGER NOT NULL DEFAULT 0,
    "totalUnattempted" INTEGER NOT NULL DEFAULT 0,
    "sumTimeSec" BIGINT NOT NULL DEFAULT 0,
    "practiceAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "computedThrough" TIMESTAMPTZ(3),
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentStat_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "StudentSubjectStat" (
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scope" "TestScope" NOT NULL,
    "evaluationMode" "EvaluationMode" NOT NULL,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "wrong" INTEGER NOT NULL DEFAULT 0,
    "sumTimeSec" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentSubjectStat_pkey" PRIMARY KEY ("studentId","subjectId","scope","evaluationMode")
);

-- CreateTable
CREATE TABLE "TestStat" (
    "testId" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "sumScore" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "maxScore" DECIMAL(8,2),
    "minScore" DECIMAL(8,2),
    "sumTimeSec" BIGINT NOT NULL DEFAULT 0,
    "scoreHistogram" JSONB,
    "topperAttemptId" TEXT,
    "attemptsIncluded" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TestStat_pkey" PRIMARY KEY ("testId")
);

-- CreateTable
CREATE TABLE "TestSectionStat" (
    "testId" TEXT NOT NULL,
    "baseConfigSectionId" TEXT NOT NULL,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "sumScore" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sumTimeSec" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TestSectionStat_pkey" PRIMARY KEY ("testId","baseConfigSectionId")
);

-- CreateTable
CREATE TABLE "TestQuestionStat" (
    "testId" TEXT NOT NULL,
    "paperQuestionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "attemptedCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "sumTimeSec" BIGINT NOT NULL DEFAULT 0,
    "optionCounts" JSONB,
    "pValue" DECIMAL(5,4),
    "discrimination" DECIMAL(6,4),
    "computedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TestQuestionStat_pkey" PRIMARY KEY ("testId","paperQuestionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exam_code_key" ON "Exam"("code");

-- CreateIndex
CREATE INDEX "Exam_family_idx" ON "Exam"("family");

-- CreateIndex
CREATE UNIQUE INDEX "ExamStage_stageKey_key" ON "ExamStage"("stageKey");

-- CreateIndex
CREATE INDEX "ExamStage_examId_idx" ON "ExamStage"("examId");

-- CreateIndex
CREATE INDEX "ExamStage_examId_order_idx" ON "ExamStage"("examId", "order");

-- CreateIndex
CREATE INDEX "ExamStage_disposition_idx" ON "ExamStage"("disposition");

-- CreateIndex
CREATE INDEX "BaseConfig_examStageId_idx" ON "BaseConfig"("examStageId");

-- CreateIndex
CREATE INDEX "BaseConfig_clonedFromId_idx" ON "BaseConfig"("clonedFromId");

-- CreateIndex
CREATE INDEX "BaseConfig_isDefault_idx" ON "BaseConfig"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfig_id_examStageId_key" ON "BaseConfig"("id", "examStageId");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfigModule_baseConfigId_order_key" ON "BaseConfigModule"("baseConfigId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfigModule_baseConfigId_id_key" ON "BaseConfigModule"("baseConfigId", "id");

-- CreateIndex
CREATE INDEX "BaseConfigSection_subjectId_idx" ON "BaseConfigSection"("subjectId");

-- CreateIndex
CREATE INDEX "BaseConfigSection_moduleId_idx" ON "BaseConfigSection"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfigSection_baseConfigId_moduleId_order_key" ON "BaseConfigSection"("baseConfigId", "moduleId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BaseConfigSection_baseConfigId_id_key" ON "BaseConfigSection"("baseConfigId", "id");

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
CREATE INDEX "Question_fixedUseCount_idx" ON "Question"("fixedUseCount");

-- CreateIndex
CREATE INDEX "Question_tags_idx" ON "Question" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_id_key" ON "QuestionVersion"("questionId", "id");

-- CreateIndex
CREATE INDEX "Test_baseConfigId_idx" ON "Test"("baseConfigId");

-- CreateIndex
CREATE INDEX "Test_examStageId_idx" ON "Test"("examStageId");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Test_id_baseConfigId_key" ON "Test"("id", "baseConfigId");

-- CreateIndex
CREATE INDEX "PaperQuestion_questionId_idx" ON "PaperQuestion"("questionId");

-- CreateIndex
CREATE INDEX "PaperQuestion_questionVersionId_idx" ON "PaperQuestion"("questionVersionId");

-- CreateIndex
CREATE INDEX "PaperQuestion_baseConfigId_baseConfigSectionId_idx" ON "PaperQuestion"("baseConfigId", "baseConfigSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_questionId_key" ON "PaperQuestion"("testId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_testId_order_key" ON "PaperQuestion"("testId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_id_questionId_questionVersionId_key" ON "PaperQuestion"("id", "questionId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperQuestion_id_baseConfigSectionId_key" ON "PaperQuestion"("id", "baseConfigSectionId");

-- CreateIndex
CREATE INDEX "Attempt_studentId_createdAt_idx" ON "Attempt"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_testId_status_idx" ON "Attempt"("testId", "status");

-- CreateIndex
CREATE INDEX "Attempt_testId_score_idx" ON "Attempt"("testId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_testId_studentId_attemptNo_key" ON "Attempt"("testId", "studentId", "attemptNo");

-- CreateIndex
CREATE INDEX "AttemptQuestion_questionId_idx" ON "AttemptQuestion"("questionId");

-- CreateIndex
CREATE INDEX "AttemptQuestion_paperQuestionId_idx" ON "AttemptQuestion"("paperQuestionId");

-- CreateIndex
CREATE INDEX "AttemptQuestion_baseConfigSectionId_idx" ON "AttemptQuestion"("baseConfigSectionId");

-- CreateIndex
CREATE INDEX "AttemptQuestion_attemptId_order_idx" ON "AttemptQuestion"("attemptId", "order");

-- CreateIndex
CREATE INDEX "Student_mobile_idx" ON "Student"("mobile");

-- CreateIndex
CREATE INDEX "Student_externalRef_idx" ON "Student"("externalRef");

-- CreateIndex
CREATE INDEX "Student_enrolledFamilies_idx" ON "Student" USING GIN ("enrolledFamilies");

-- CreateIndex
CREATE INDEX "Student_enrolledExams_idx" ON "Student" USING GIN ("enrolledExams");

-- CreateIndex
CREATE INDEX "Student_programs_idx" ON "Student" USING GIN ("programs");

-- CreateIndex
CREATE INDEX "Student_currentBranchId_idx" ON "Student"("currentBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_studentId_key" ON "StudentProfile"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "AdminBranch_branchId_idx" ON "AdminBranch"("branchId");

-- CreateIndex
CREATE INDEX "AdminFeaturePermission_featureKey_idx" ON "AdminFeaturePermission"("featureKey");

-- CreateIndex
CREATE INDEX "Branch_name_idx" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Program_code_key" ON "Program"("code");

-- CreateIndex
CREATE INDEX "TestSeries_examStageId_idx" ON "TestSeries"("examStageId");

-- CreateIndex
CREATE INDEX "TestSeries_programCode_idx" ON "TestSeries"("programCode");

-- CreateIndex
CREATE INDEX "TestSeries_prerequisiteSeriesId_idx" ON "TestSeries"("prerequisiteSeriesId");

-- CreateIndex
CREATE INDEX "TestSeriesTest_testId_idx" ON "TestSeriesTest"("testId");

-- CreateIndex
CREATE INDEX "StudentGrant_testSeriesId_idx" ON "StudentGrant"("testSeriesId");

-- CreateIndex
CREATE INDEX "StudentSeriesUnlock_testSeriesId_idx" ON "StudentSeriesUnlock"("testSeriesId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSeriesUnlock_studentId_testSeriesId_key" ON "StudentSeriesUnlock"("studentId", "testSeriesId");

-- CreateIndex
CREATE INDEX "SeriesUnlockRequest_studentId_testSeriesId_status_idx" ON "SeriesUnlockRequest"("studentId", "testSeriesId", "status");

-- CreateIndex
CREATE INDEX "SeriesUnlockRequest_testSeriesId_status_idx" ON "SeriesUnlockRequest"("testSeriesId", "status");

-- CreateIndex
CREATE INDEX "BranchTestConfig_testSeriesId_idx" ON "BranchTestConfig"("testSeriesId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchTestConfig_branchId_testSeriesId_key" ON "BranchTestConfig"("branchId", "testSeriesId");

-- CreateIndex
CREATE INDEX "ImportLog_feature_startedAt_idx" ON "ImportLog"("feature", "startedAt");

-- CreateIndex
CREATE INDEX "RowActionLog_feature_entityId_createdAt_idx" ON "RowActionLog"("feature", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "RowActionLog_actorId_createdAt_idx" ON "RowActionLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "RowActionLog_createdAt_idx" ON "RowActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "RowActionLog_importLogId_idx" ON "RowActionLog"("importLogId");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_createdAt_idx" ON "OutboxEvent"("aggregateType", "aggregateId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_studentId_createdAt_idx" ON "Notification"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_studentId_isRead_idx" ON "Notification"("studentId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_testId_idx" ON "Notification"("testId");

-- CreateIndex
CREATE INDEX "Notification_testSeriesId_idx" ON "Notification"("testSeriesId");

-- CreateIndex
CREATE INDEX "StudentSubjectStat_subjectId_idx" ON "StudentSubjectStat"("subjectId");

-- CreateIndex
CREATE INDEX "TestStat_topperAttemptId_idx" ON "TestStat"("topperAttemptId");

-- CreateIndex
CREATE INDEX "TestSectionStat_baseConfigSectionId_idx" ON "TestSectionStat"("baseConfigSectionId");

-- CreateIndex
CREATE INDEX "TestQuestionStat_paperQuestionId_idx" ON "TestQuestionStat"("paperQuestionId");

-- CreateIndex
CREATE INDEX "TestQuestionStat_questionId_idx" ON "TestQuestionStat"("questionId");

-- AddForeignKey
ALTER TABLE "ExamStage" ADD CONSTRAINT "ExamStage_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfig" ADD CONSTRAINT "BaseConfig_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfig" ADD CONSTRAINT "BaseConfig_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "BaseConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfigModule" ADD CONSTRAINT "BaseConfigModule_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_baseConfigId_moduleId_fkey" FOREIGN KEY ("baseConfigId", "moduleId") REFERENCES "BaseConfigModule"("baseConfigId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_id_currentVersionId_fkey" FOREIGN KEY ("id", "currentVersionId") REFERENCES "QuestionVersion"("questionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_baseConfigId_examStageId_fkey" FOREIGN KEY ("baseConfigId", "examStageId") REFERENCES "BaseConfig"("id", "examStageId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_testId_baseConfigId_fkey" FOREIGN KEY ("testId", "baseConfigId") REFERENCES "Test"("id", "baseConfigId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_baseConfigId_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigId", "baseConfigSectionId") REFERENCES "BaseConfigSection"("baseConfigId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_paperQuestionId_questionId_questionVersion_fkey" FOREIGN KEY ("paperQuestionId", "questionId", "questionVersionId") REFERENCES "PaperQuestion"("id", "questionId", "questionVersionId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_paperQuestionId_baseConfigSectionId_fkey" FOREIGN KEY ("paperQuestionId", "baseConfigSectionId") REFERENCES "PaperQuestion"("id", "baseConfigSectionId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigSectionId") REFERENCES "BaseConfigSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_currentBranchId_fkey" FOREIGN KEY ("currentBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminBranch" ADD CONSTRAINT "AdminBranch_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminBranch" ADD CONSTRAINT "AdminBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminFeaturePermission" ADD CONSTRAINT "AdminFeaturePermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_programCode_fkey" FOREIGN KEY ("programCode") REFERENCES "Program"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_prerequisiteSeriesId_fkey" FOREIGN KEY ("prerequisiteSeriesId") REFERENCES "TestSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeriesTest" ADD CONSTRAINT "TestSeriesTest_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSeriesTest" ADD CONSTRAINT "TestSeriesTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGrant" ADD CONSTRAINT "StudentGrant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGrant" ADD CONSTRAINT "StudentGrant_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSeriesUnlock" ADD CONSTRAINT "StudentSeriesUnlock_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSeriesUnlock" ADD CONSTRAINT "StudentSeriesUnlock_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesUnlockRequest" ADD CONSTRAINT "SeriesUnlockRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesUnlockRequest" ADD CONSTRAINT "SeriesUnlockRequest_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTestConfig" ADD CONSTRAINT "BranchTestConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTestConfig" ADD CONSTRAINT "BranchTestConfig_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RowActionLog" ADD CONSTRAINT "RowActionLog_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedRollup" ADD CONSTRAINT "ProcessedRollup_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentStat" ADD CONSTRAINT "StudentStat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubjectStat" ADD CONSTRAINT "StudentSubjectStat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSubjectStat" ADD CONSTRAINT "StudentSubjectStat_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestStat" ADD CONSTRAINT "TestStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestStat" ADD CONSTRAINT "TestStat_topperAttemptId_fkey" FOREIGN KEY ("topperAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSectionStat" ADD CONSTRAINT "TestSectionStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSectionStat" ADD CONSTRAINT "TestSectionStat_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigSectionId") REFERENCES "BaseConfigSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_paperQuestionId_fkey" FOREIGN KEY ("paperQuestionId") REFERENCES "PaperQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Invariants Prisma cannot express.
--
-- Everything above this line is generated from prisma/schema.prisma. Everything
-- below is hand-written because the Prisma schema language has no syntax for
-- it: NOT NULL on a scalar list, a partial index, a CHECK constraint, or a
-- trigger. Each one is part of the target model in docs/schema-target.dbml, not
-- an extra — leaving them out would let the database accept rows the model
-- forbids, and no amount of service-layer care closes a hole that any other
-- write path can walk through.
--
-- None of it is visible to `prisma migrate diff`, so `pnpm db:check` stays
-- clean: Postgres keeps the constraint, Prisma simply does not model it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Required arrays.
--
-- Prisma treats a scalar list as always-present and defaults it to an empty
-- array in the client, but it emits the column as nullable. The four lists the
-- target marks [not null] are ones the exam path reads without a null check —
-- a null `languages` on a config or an attempt has no meaning, and a null
-- enrolment array would silently drop a student out of every access query.
-- ---------------------------------------------------------------------------
ALTER TABLE "BaseConfig" ALTER COLUMN "languages" SET NOT NULL;
ALTER TABLE "Attempt" ALTER COLUMN "languages" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "enrolledFamilies" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "enrolledExams" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Partial unique indexes.
--
-- Soft delete and uniqueness pull against each other: a plain UNIQUE keeps a
-- deleted row's slot forever, so the mobile number of a student who was removed
-- could never be handed to the person who now has it. Scoping the index to the
-- live rows releases the slot on delete and still refuses a duplicate among
-- the living.
--
-- The remaining four are conditional rules a plain unique cannot state at all:
-- a student has exactly one GRADED attempt per test but any number of practice
-- retakes; exactly one PENDING unlock request per series but any number of
-- decided ones; exactly one DEFAULT config per stage but any number of custom
-- ones; and a flat config's section order is unique per config only while
-- module_id is null (nulls are distinct, so the composite unique on
-- (baseConfigId, moduleId, order) does not stop two null-module sections
-- sharing an order).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Student_mobile_live_key" ON "Student"("mobile") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Student_externalRef_live_key" ON "Student"("externalRef") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Branch_name_live_key" ON "Branch"("name") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Attempt_graded_per_test_key" ON "Attempt"("testId", "studentId") WHERE "isGraded";
CREATE UNIQUE INDEX "SeriesUnlockRequest_open_key" ON "SeriesUnlockRequest"("studentId", "testSeriesId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "BaseConfig_default_per_stage_key" ON "BaseConfig"("examStageId") WHERE "isDefault";
CREATE UNIQUE INDEX "BaseConfigSection_flat_order_key" ON "BaseConfigSection"("baseConfigId", "order") WHERE "moduleId" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Outbox poll index.
--
-- The relay claims work with SELECT ... WHERE "processedAt" IS NULL ORDER BY
-- "createdAt" FOR UPDATE SKIP LOCKED. Pending rows are a shrinking tail of a
-- table that only ever grows, so a full index would spend all of itself on
-- history the poll never looks at.
-- ---------------------------------------------------------------------------
CREATE INDEX "OutboxEvent_pending_idx" ON "OutboxEvent"("createdAt") WHERE "processedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. A ranked test must be a fixed paper.
--
-- A rank only means anything if every student sat the same questions. RANKED
-- with a GENERATED paper would produce a leaderboard comparing people who
-- answered different papers.
-- ---------------------------------------------------------------------------
ALTER TABLE "Test" ADD CONSTRAINT "Test_ranked_requires_fixed_check"
  CHECK ("evaluationMode" <> 'RANKED' OR "paperBinding" = 'FIXED');

-- ---------------------------------------------------------------------------
-- 5. Section shape follows the config's timer template.
--
-- These are the three rules the target model writes as CHECK constraints, but
-- all three read the PARENT config's timerTemplate and a CHECK only ever sees
-- its own row. A trigger is the only mechanism Postgres offers for a rule that
-- spans two tables.
--
-- They are DEFERRED constraint triggers, checked at commit rather than at each
-- statement, because the rules can be broken from either end and satisfying
-- them can require moving both ends at once. Switching a draft config to
-- SESSION_MODULE_LOCKED needs its sections to gain a moduleId, and a section
-- may only carry a moduleId once its config is SESSION_MODULE_LOCKED — checked
-- per statement, neither order succeeds and the only way through is to delete
-- every section first. Deferring lets one transaction move the config and its
-- sections together and be judged on where it ends up. The cost is that the
-- error arrives when the transaction commits, not on the offending statement.
--
-- Both re-read from the table rather than trusting NEW: by commit the row may
-- have been changed again, or deleted, by a later statement in the same
-- transaction. A row that is gone is nothing to validate.
--
-- Every comparison is null when the template is null, so a section whose
-- baseConfigId does not exist passes here and is rejected by the foreign key,
-- with a better message than this could give.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION base_config_assert_section_shape(
  section_id text,
  template "TimerTemplate",
  module_id text,
  duration_sec integer,
  per_question_sec integer
) RETURNS void AS $$
BEGIN
  IF template = 'SESSION_MODULE_LOCKED' AND module_id IS NULL THEN
    RAISE EXCEPTION 'section %: moduleId is required when the config is SESSION_MODULE_LOCKED', section_id;
  END IF;

  IF template <> 'SESSION_MODULE_LOCKED' AND module_id IS NOT NULL THEN
    RAISE EXCEPTION 'section %: moduleId is only allowed when the config is SESSION_MODULE_LOCKED', section_id;
  END IF;

  IF template = 'SECTIONAL_LOCKED' AND duration_sec IS NULL THEN
    RAISE EXCEPTION 'section %: durationSec is required when the config is SECTIONAL_LOCKED', section_id;
  END IF;

  IF template = 'PER_ITEM_TIMED' AND per_question_sec IS NULL THEN
    RAISE EXCEPTION 'section %: perQuestionSec is required when the config is PER_ITEM_TIMED', section_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION base_config_section_shape_guard() RETURNS trigger AS $$
DECLARE
  section record;
  template "TimerTemplate";
BEGIN
  SELECT * INTO section FROM "BaseConfigSection" WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT "timerTemplate" INTO template FROM "BaseConfig" WHERE "id" = section."baseConfigId";
  PERFORM base_config_assert_section_shape(
    section."id", template, section."moduleId", section."durationSec", section."perQuestionSec");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER base_config_section_shape_guard
  AFTER INSERT OR UPDATE ON "BaseConfigSection"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION base_config_section_shape_guard();

CREATE OR REPLACE FUNCTION base_config_shape_guard() RETURNS trigger AS $$
DECLARE
  template "TimerTemplate";
  section record;
BEGIN
  SELECT "timerTemplate" INTO template FROM "BaseConfig" WHERE "id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR section IN SELECT * FROM "BaseConfigSection" WHERE "baseConfigId" = NEW."id" LOOP
    PERFORM base_config_assert_section_shape(
      section."id", template, section."moduleId", section."durationSec", section."perQuestionSec");
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER base_config_shape_guard
  AFTER UPDATE OF "timerTemplate" ON "BaseConfig"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION base_config_shape_guard();

-- ---------------------------------------------------------------------------
-- 6. A locked config's SHAPE is immutable.
--
-- `locked` trips at the first finalize of any test built from the config, which
-- is the moment a paper is frozen against its shape. Changing the shape
-- afterwards would silently rewrite the rules an already-sat paper was scored
-- under, so the way to change a locked config is to clone it.
--
-- Only the shape freezes. name, isDefault and isActive stay writable, and that
-- is not a loophole but the thing that makes clone-to-evolve possible: a stage
-- may hold only one default config, so promoting a clone means first clearing
-- isDefault on the locked original. Freezing every column would deadlock the
-- stage on the config that locked first — it could never be replaced, and it
-- cannot be deleted either, because Test and the lineage pointer both restrict.
--
-- `locked` is in the frozen list, so re-asserting true over true is a no-op the
-- guard allows, while unlocking is refused.
--
-- The child guard checks BOTH ends of a write. Reading only NEW."baseConfigId"
-- catches a section moved INTO a locked config and misses one moved OUT of it,
-- which is the same hole from the other side: the locked config silently loses
-- a section. The foreign keys do not cover it — a GENERATED test has no
-- PaperQuestion rows to restrict the move, and a module with no sections has
-- nothing pointing at it at all.
--
-- The lookup takes FOR NO KEY UPDATE, not FOR SHARE. It has to conflict with
-- the finalize's UPDATE ... SET locked = true, or a section edit and a finalize
-- both commit and the shape changes after the paper froze against it. FOR SHARE
-- conflicts too, but it is weaker than the lock an ordinary UPDATE takes, so
-- the natural "edit the sections, then recompute totalQuestions on the parent"
-- transaction has to upgrade — and two of those deadlock each other. At this
-- strength they queue instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION base_config_assert_unlocked(config_id text) RETURNS void AS $$
DECLARE
  config_locked boolean;
BEGIN
  SELECT "locked" INTO config_locked
    FROM "BaseConfig" WHERE "id" = config_id FOR NO KEY UPDATE;

  IF config_locked THEN
    RAISE EXCEPTION 'base config % is locked; its shape cannot change', config_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION base_config_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."locked" THEN
      RAISE EXCEPTION 'base config % is locked; it cannot be deleted', OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."locked" AND (
       NEW."examStageId"          IS DISTINCT FROM OLD."examStageId"
    OR NEW."clonedFromId"         IS DISTINCT FROM OLD."clonedFromId"
    OR NEW."version"              IS DISTINCT FROM OLD."version"
    OR NEW."locked"               IS DISTINCT FROM OLD."locked"
    OR NEW."totalQuestions"       IS DISTINCT FROM OLD."totalQuestions"
    OR NEW."totalMarks"           IS DISTINCT FROM OLD."totalMarks"
    OR NEW."durationSec"          IS DISTINCT FROM OLD."durationSec"
    OR NEW."timerTemplate"        IS DISTINCT FROM OLD."timerTemplate"
    OR NEW."navigation"           IS DISTINCT FROM OLD."navigation"
    OR NEW."optionalSectionCount" IS DISTINCT FROM OLD."optionalSectionCount"
    OR NEW."defaultTestUi"        IS DISTINCT FROM OLD."defaultTestUi"
    OR NEW."languageMode"         IS DISTINCT FROM OLD."languageMode"
    OR NEW."languages"            IS DISTINCT FROM OLD."languages"
    OR NEW."shuffleQuestions"     IS DISTINCT FROM OLD."shuffleQuestions"
    OR NEW."shuffleOptions"       IS DISTINCT FROM OLD."shuffleOptions"
    OR NEW."calculatorEnabled"    IS DISTINCT FROM OLD."calculatorEnabled"
    OR NEW."featureFlags"         IS DISTINCT FROM OLD."featureFlags"
    OR NEW."scoringVersion"       IS DISTINCT FROM OLD."scoringVersion"
  ) THEN
    RAISE EXCEPTION 'base config % is locked; clone it to change its shape', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER base_config_guard
  BEFORE UPDATE OR DELETE ON "BaseConfig"
  FOR EACH ROW EXECUTE FUNCTION base_config_guard();

CREATE OR REPLACE FUNCTION base_config_child_guard() RETURNS trigger AS $$
DECLARE
  source_id text;
  target_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    source_id := OLD."baseConfigId";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target_id := NEW."baseConfigId";
  END IF;

  -- Lowest id first, so two transactions re-parenting in opposite directions
  -- take the two config rows in the same order and queue instead of deadlocking.
  IF source_id IS NOT NULL AND target_id IS NOT NULL AND source_id <> target_id THEN
    PERFORM base_config_assert_unlocked(LEAST(source_id, target_id));
    PERFORM base_config_assert_unlocked(GREATEST(source_id, target_id));
  ELSE
    PERFORM base_config_assert_unlocked(COALESCE(source_id, target_id));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER base_config_section_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "BaseConfigSection"
  FOR EACH ROW EXECUTE FUNCTION base_config_child_guard();

CREATE TRIGGER base_config_module_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "BaseConfigModule"
  FOR EACH ROW EXECUTE FUNCTION base_config_child_guard();

-- TRUNCATE fires no row triggers, so it walks past every guard above and takes
-- a locked config's shape with it. Nothing in the application emits it — Prisma
-- never does — but the target model asks for these rules to hold in the
-- database rather than only in the service, and this is the one statement that
-- would otherwise ignore them.
CREATE OR REPLACE FUNCTION base_config_truncate_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'truncating % would bypass the locked-config guards; delete the rows instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER base_config_truncate_guard
  BEFORE TRUNCATE ON "BaseConfig"
  FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();

CREATE TRIGGER base_config_section_truncate_guard
  BEFORE TRUNCATE ON "BaseConfigSection"
  FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();

CREATE TRIGGER base_config_module_truncate_guard
  BEFORE TRUNCATE ON "BaseConfigModule"
  FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();
