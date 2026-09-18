-- Every row id becomes a native Postgres uuid: 105 columns across 40 tables, and TestSeries's
-- branchIds array with them. Nothing about what an id MEANS changes; only how it is stored.
--
-- WHY. Measured on a copy of this schema holding 21 exams -- 105,000 sittings, 100,000 outbox
-- events -- with real 25-character cuids, against the same data converted:
--
--   whole database                42.8 MB -> 40.6 MB        (-5%)
--   per sitting                   2,472 B -> 2,274 B        (-198 B)
--   id indexes                                              (-23% to -33%)
--   primary key index, 520K rows  24.68 MB -> 15.66 MB      (-37%)
--   sorting 5,000 ids             3.7-3.9 ms -> 1.0-1.2 ms
--
-- A uuid is 16 bytes where a cuid is 26, and it compares as bytes rather than as text under the
-- database's en_US.utf8 collation rules, which is what made sorting ids slow. Prisma generates
-- version 7, whose leading timestamp keeps new rows at the right-hand edge of the index exactly as
-- cuid's did: measured, 90% leaf density and 5.11 MB of WAL per 20,000 inserts, against 68% and
-- 18.93 MB for random version 4. A random id would have been the expensive mistake here, not text.
--
-- WHY NOW. This is cheap only before launch. Afterwards every id in every environment has to be
-- rewritten in place, along with every id held outside Postgres, instead of simply recreated.
--
-- WHAT IS NOT CONVERTED. NotificationDelivery."templateId" and "providerMessageId" are an SMS
-- provider's ids, not ours. PaperQuestion."optionIds" holds option ids that live inside question
-- JSON, so they stay text and match. Student."programs" and "enrolledExams" are codes, as are the
-- Program and Exam references that point at "code" rather than "id".
--
-- WHAT THIS FILE HAS TO WORK AROUND, all found by converting a real copy:
--   - branchIds cannot be cast while it has a '{}' default, so the default is dropped and restored.
--   - A column cannot change type while a trigger names it, so all 11 triggers go and come back.
--   - Foreign keys must match on both sides, so all 57 go and come back.
--   - The AttemptSheetAnswer view reads converted columns, so it is recreated afterwards.
--   - base_config_assert_unlocked, base_config_assert_section_shape and base_config_child_guard
--     declare their ids `text`. Left alone, every write to a blueprint's sections would fail with
--     `operator does not exist: uuid = text`. They are recreated below taking uuid.
--
-- IT REFUSES TO RUN ON A DATABASE THAT HOLDS ROWS. Nothing anywhere holds data worth keeping
-- (agreed 2026-09-18), and cuids cannot be cast to uuids, so there is no conversion to offer -- only
-- a silent wipe, which is worse than a refusal. Reset and reseed instead: pnpm db:setup.

DO $$
DECLARE
  crowded text[] := '{}';
  occupied boolean;
  each_table record;
BEGIN
  FOR each_table IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', each_table.relname) INTO occupied;
    IF occupied THEN crowded := crowded || each_table.relname; END IF;
  END LOOP;

  IF cardinality(crowded) > 0 THEN
    RAISE EXCEPTION E'This migration changes every id to a uuid, and a cuid cannot be converted into one.\nRows are present in: %.\nReset and reseed instead: pnpm db:setup.', array_to_string(crowded, ', ');
  END IF;
END $$;

-- ============ DROP: view, foreign keys, triggers ============
DROP VIEW "AttemptSheetAnswer";
ALTER TABLE "AdminFeaturePermission" DROP CONSTRAINT "AdminFeaturePermission_adminId_fkey";
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_createdById_fkey";
ALTER TABLE "Attempt" DROP CONSTRAINT "Attempt_studentId_fkey";
ALTER TABLE "Attempt" DROP CONSTRAINT "Attempt_testId_fkey";
ALTER TABLE "AttemptSheet" DROP CONSTRAINT "AttemptSheet_attemptId_fkey";
ALTER TABLE "BaseConfig" DROP CONSTRAINT "BaseConfig_clonedFromId_fkey";
ALTER TABLE "BaseConfig" DROP CONSTRAINT "BaseConfig_examStageId_fkey";
ALTER TABLE "BaseConfigModule" DROP CONSTRAINT "BaseConfigModule_baseConfigId_fkey";
ALTER TABLE "BaseConfigSection" DROP CONSTRAINT "BaseConfigSection_baseConfigId_fkey";
ALTER TABLE "BaseConfigSection" DROP CONSTRAINT "BaseConfigSection_baseConfigId_moduleId_fkey";
ALTER TABLE "BaseConfigSection" DROP CONSTRAINT "BaseConfigSection_subjectId_fkey";
ALTER TABLE "EventCandidate" DROP CONSTRAINT "EventCandidate_eventId_fkey";
ALTER TABLE "EventCandidate" DROP CONSTRAINT "EventCandidate_studentId_fkey";
ALTER TABLE "ExamStage" DROP CONSTRAINT "ExamStage_examId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_adminId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_announcementId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_studentId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_testId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_testSeriesId_fkey";
ALTER TABLE "NotificationDelivery" DROP CONSTRAINT "NotificationDelivery_notificationId_fkey";
ALTER TABLE "PaperQuestion" DROP CONSTRAINT "PaperQuestion_baseConfigId_baseConfigSectionId_fkey";
ALTER TABLE "PaperQuestion" DROP CONSTRAINT "PaperQuestion_questionId_fkey";
ALTER TABLE "PaperQuestion" DROP CONSTRAINT "PaperQuestion_questionId_questionVersionId_fkey";
ALTER TABLE "PaperQuestion" DROP CONSTRAINT "PaperQuestion_testId_baseConfigId_fkey";
ALTER TABLE "ProcessedRollup" DROP CONSTRAINT "ProcessedRollup_attemptId_fkey";
ALTER TABLE "PushSubscription" DROP CONSTRAINT "PushSubscription_studentId_fkey";
ALTER TABLE "Question" DROP CONSTRAINT "Question_createdById_fkey";
ALTER TABLE "Question" DROP CONSTRAINT "Question_id_currentVersionId_fkey";
ALTER TABLE "Question" DROP CONSTRAINT "Question_subjectId_fkey";
ALTER TABLE "Question" DROP CONSTRAINT "Question_topicId_fkey";
ALTER TABLE "QuestionFlag" DROP CONSTRAINT "QuestionFlag_questionId_fkey";
ALTER TABLE "QuestionVersion" DROP CONSTRAINT "QuestionVersion_questionId_fkey";
ALTER TABLE "RowActionLog" DROP CONSTRAINT "RowActionLog_importLogId_fkey";
ALTER TABLE "SavedQuestion" DROP CONSTRAINT "SavedQuestion_questionId_fkey";
ALTER TABLE "SavedQuestion" DROP CONSTRAINT "SavedQuestion_studentId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT "Student_currentBranchId_fkey";
ALTER TABLE "StudentConsent" DROP CONSTRAINT "StudentConsent_studentId_fkey";
ALTER TABLE "StudentGrant" DROP CONSTRAINT "StudentGrant_studentId_fkey";
ALTER TABLE "StudentGrant" DROP CONSTRAINT "StudentGrant_testSeriesId_fkey";
ALTER TABLE "StudentProfile" DROP CONSTRAINT "StudentProfile_studentId_fkey";
ALTER TABLE "StudentStat" DROP CONSTRAINT "StudentStat_studentId_fkey";
ALTER TABLE "StudentSubjectStat" DROP CONSTRAINT "StudentSubjectStat_studentId_fkey";
ALTER TABLE "StudentSubjectStat" DROP CONSTRAINT "StudentSubjectStat_subjectId_fkey";
ALTER TABLE "Test" DROP CONSTRAINT "Test_baseConfigId_examStageId_fkey";
ALTER TABLE "Test" DROP CONSTRAINT "Test_examStageId_fkey";
ALTER TABLE "Test" DROP CONSTRAINT "Test_testSeriesId_fkey";
ALTER TABLE "TestProgramUnlock" DROP CONSTRAINT "TestProgramUnlock_testId_fkey";
ALTER TABLE "TestQuestionStat" DROP CONSTRAINT "TestQuestionStat_paperQuestionId_fkey";
ALTER TABLE "TestQuestionStat" DROP CONSTRAINT "TestQuestionStat_questionId_fkey";
ALTER TABLE "TestQuestionStat" DROP CONSTRAINT "TestQuestionStat_testId_fkey";
ALTER TABLE "TestSectionStat" DROP CONSTRAINT "TestSectionStat_baseConfigSectionId_fkey";
ALTER TABLE "TestSectionStat" DROP CONSTRAINT "TestSectionStat_testId_fkey";
ALTER TABLE "TestSeries" DROP CONSTRAINT "TestSeries_eventId_fkey";
ALTER TABLE "TestSeries" DROP CONSTRAINT "TestSeries_examStageId_fkey";
ALTER TABLE "TestStat" DROP CONSTRAINT "TestStat_testId_fkey";
ALTER TABLE "TestStat" DROP CONSTRAINT "TestStat_topperAttemptId_fkey";
ALTER TABLE "Topic" DROP CONSTRAINT "Topic_subjectId_fkey";
DROP TRIGGER base_config_guard ON "BaseConfig";
DROP TRIGGER base_config_module_guard ON "BaseConfigModule";
DROP TRIGGER base_config_module_truncate_guard ON "BaseConfigModule";
DROP TRIGGER base_config_section_guard ON "BaseConfigSection";
DROP TRIGGER base_config_section_shape_guard ON "BaseConfigSection";
DROP TRIGGER base_config_section_truncate_guard ON "BaseConfigSection";
DROP TRIGGER base_config_shape_guard ON "BaseConfig";
DROP TRIGGER base_config_truncate_guard ON "BaseConfig";
DROP TRIGGER paper_question_option_ids ON "PaperQuestion";
DROP TRIGGER paper_question_sat_guard ON "PaperQuestion";
DROP TRIGGER question_version_sat_guard ON "QuestionVersion";

-- ============ CONVERT: one statement per table ============
ALTER TABLE "Admin"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "AdminFeaturePermission"
  ALTER COLUMN "adminId" TYPE uuid USING "adminId"::uuid;
ALTER TABLE "Announcement"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "Attempt"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid,
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid,
  ALTER COLUMN "voidedById" TYPE uuid USING "voidedById"::uuid;
ALTER TABLE "AttemptSheet"
  ALTER COLUMN "attemptId" TYPE uuid USING "attemptId"::uuid;
ALTER TABLE "BaseConfig"
  ALTER COLUMN "clonedFromId" TYPE uuid USING "clonedFromId"::uuid,
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN "examStageId" TYPE uuid USING "examStageId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "BaseConfigModule"
  ALTER COLUMN "baseConfigId" TYPE uuid USING "baseConfigId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "BaseConfigSection"
  ALTER COLUMN "baseConfigId" TYPE uuid USING "baseConfigId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "moduleId" TYPE uuid USING "moduleId"::uuid,
  ALTER COLUMN "subjectId" TYPE uuid USING "subjectId"::uuid;
ALTER TABLE "Branch"
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "Event"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "EventCandidate"
  ALTER COLUMN "eventId" TYPE uuid USING "eventId"::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "Exam"
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "ExamStage"
  ALTER COLUMN "examId" TYPE uuid USING "examId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "ImportLog"
  ALTER COLUMN "actorId" TYPE uuid USING "actorId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "Notification"
  ALTER COLUMN "adminId" TYPE uuid USING "adminId"::uuid,
  ALTER COLUMN "announcementId" TYPE uuid USING "announcementId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid,
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid,
  ALTER COLUMN "testSeriesId" TYPE uuid USING "testSeriesId"::uuid;
ALTER TABLE "NotificationDelivery"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "notificationId" TYPE uuid USING "notificationId"::uuid;
ALTER TABLE "OutboxEvent"
  ALTER COLUMN "aggregateId" TYPE uuid USING "aggregateId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "PaperQuestion"
  ALTER COLUMN "baseConfigId" TYPE uuid USING "baseConfigId"::uuid,
  ALTER COLUMN "baseConfigSectionId" TYPE uuid USING "baseConfigSectionId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "questionId" TYPE uuid USING "questionId"::uuid,
  ALTER COLUMN "questionVersionId" TYPE uuid USING "questionVersionId"::uuid,
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid;
ALTER TABLE "ProcessedRollup"
  ALTER COLUMN "attemptId" TYPE uuid USING "attemptId"::uuid;
ALTER TABLE "Program"
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "PushSubscription"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "Question"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN "currentVersionId" TYPE uuid USING "currentVersionId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "subjectId" TYPE uuid USING "subjectId"::uuid,
  ALTER COLUMN "topicId" TYPE uuid USING "topicId"::uuid;
ALTER TABLE "QuestionFlag"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "questionId" TYPE uuid USING "questionId"::uuid,
  ALTER COLUMN "raisedById" TYPE uuid USING "raisedById"::uuid,
  ALTER COLUMN "resolvedById" TYPE uuid USING "resolvedById"::uuid,
  ALTER COLUMN "versionId" TYPE uuid USING "versionId"::uuid;
ALTER TABLE "QuestionVersion"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "questionId" TYPE uuid USING "questionId"::uuid;
ALTER TABLE "RowActionLog"
  ALTER COLUMN "actorId" TYPE uuid USING "actorId"::uuid,
  ALTER COLUMN "entityId" TYPE uuid USING "entityId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "importLogId" TYPE uuid USING "importLogId"::uuid;
ALTER TABLE "SavedQuestion"
  ALTER COLUMN "attemptId" TYPE uuid USING "attemptId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "paperQuestionId" TYPE uuid USING "paperQuestionId"::uuid,
  ALTER COLUMN "questionId" TYPE uuid USING "questionId"::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "Student"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN "currentBranchId" TYPE uuid USING "currentBranchId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "StudentConsent"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "StudentGrant"
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid,
  ALTER COLUMN "testSeriesId" TYPE uuid USING "testSeriesId"::uuid;
ALTER TABLE "StudentProfile"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "StudentStat"
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid;
ALTER TABLE "StudentSubjectStat"
  ALTER COLUMN "studentId" TYPE uuid USING "studentId"::uuid,
  ALTER COLUMN "subjectId" TYPE uuid USING "subjectId"::uuid;
ALTER TABLE "Subject"
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "Test"
  ALTER COLUMN "baseConfigId" TYPE uuid USING "baseConfigId"::uuid,
  ALTER COLUMN "createdById" TYPE uuid USING "createdById"::uuid,
  ALTER COLUMN "examStageId" TYPE uuid USING "examStageId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "testSeriesId" TYPE uuid USING "testSeriesId"::uuid;
ALTER TABLE "TestProgramUnlock"
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid;
ALTER TABLE "TestQuestionStat"
  ALTER COLUMN "paperQuestionId" TYPE uuid USING "paperQuestionId"::uuid,
  ALTER COLUMN "questionId" TYPE uuid USING "questionId"::uuid,
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid;
ALTER TABLE "TestSectionStat"
  ALTER COLUMN "baseConfigSectionId" TYPE uuid USING "baseConfigSectionId"::uuid,
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid;
ALTER TABLE "TestSeries"
  ALTER COLUMN "branchIds" DROP DEFAULT,
  ALTER COLUMN "branchIds" TYPE uuid[] USING "branchIds"::uuid[],
  ALTER COLUMN "branchIds" SET DEFAULT '{}',
  ALTER COLUMN "eventId" TYPE uuid USING "eventId"::uuid,
  ALTER COLUMN "examStageId" TYPE uuid USING "examStageId"::uuid,
  ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE "TestStat"
  ALTER COLUMN "testId" TYPE uuid USING "testId"::uuid,
  ALTER COLUMN "topperAttemptId" TYPE uuid USING "topperAttemptId"::uuid;
ALTER TABLE "Topic"
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN "subjectId" TYPE uuid USING "subjectId"::uuid;


-- ============ The three functions whose ids were declared text ============
-- Same bodies; only the types change. The old signatures go, or a call with uuid arguments would
-- leave them behind as dead code that still compiles.

DROP FUNCTION base_config_assert_unlocked(text);
DROP FUNCTION base_config_assert_section_shape(text, "TimerTemplate", text, integer, integer);

CREATE FUNCTION base_config_assert_unlocked(config_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  config_locked boolean;
BEGIN
  SELECT "locked" INTO config_locked
    FROM "BaseConfig" WHERE "id" = config_id FOR NO KEY UPDATE;

  IF config_locked THEN
    RAISE EXCEPTION 'base config % is locked; its shape cannot change', config_id;
  END IF;
END;
$$;

CREATE FUNCTION base_config_assert_section_shape(section_id uuid, template "TimerTemplate", module_id uuid, duration_sec integer, per_question_sec integer) RETURNS void LANGUAGE plpgsql AS $$
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
$$;

CREATE OR REPLACE FUNCTION base_config_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_id uuid;
  target_id uuid;
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
$$;

-- ============ RESTORE: foreign keys, triggers, view ============
ALTER TABLE "AdminFeaturePermission" ADD CONSTRAINT "AdminFeaturePermission_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "AttemptSheet" ADD CONSTRAINT "AttemptSheet_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "BaseConfig" ADD CONSTRAINT "BaseConfig_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "BaseConfig"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "BaseConfig" ADD CONSTRAINT "BaseConfig_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "BaseConfigModule" ADD CONSTRAINT "BaseConfigModule_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_baseConfigId_fkey" FOREIGN KEY ("baseConfigId") REFERENCES "BaseConfig"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_baseConfigId_moduleId_fkey" FOREIGN KEY ("baseConfigId", "moduleId") REFERENCES "BaseConfigModule"("baseConfigId", id) ON DELETE RESTRICT;
ALTER TABLE "BaseConfigSection" ADD CONSTRAINT "BaseConfigSection_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "EventCandidate" ADD CONSTRAINT "EventCandidate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "EventCandidate" ADD CONSTRAINT "EventCandidate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "ExamStage" ADD CONSTRAINT "ExamStage_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_baseConfigId_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigId", "baseConfigSectionId") REFERENCES "BaseConfigSection"("baseConfigId", id) ON DELETE RESTRICT;
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_questionId_questionVersionId_fkey" FOREIGN KEY ("questionId", "questionVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_testId_baseConfigId_fkey" FOREIGN KEY ("testId", "baseConfigId") REFERENCES "Test"(id, "baseConfigId") ON DELETE CASCADE;
ALTER TABLE "ProcessedRollup" ADD CONSTRAINT "ProcessedRollup_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Question" ADD CONSTRAINT "Question_id_currentVersionId_fkey" FOREIGN KEY (id, "currentVersionId") REFERENCES "QuestionVersion"("questionId", id) ON DELETE RESTRICT;
ALTER TABLE "Question" ADD CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "QuestionFlag" ADD CONSTRAINT "QuestionFlag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "RowActionLog" ADD CONSTRAINT "RowActionLog_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "SavedQuestion" ADD CONSTRAINT "SavedQuestion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_currentBranchId_fkey" FOREIGN KEY ("currentBranchId") REFERENCES "Branch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentGrant" ADD CONSTRAINT "StudentGrant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentGrant" ADD CONSTRAINT "StudentGrant_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentStat" ADD CONSTRAINT "StudentStat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentSubjectStat" ADD CONSTRAINT "StudentSubjectStat_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "StudentSubjectStat" ADD CONSTRAINT "StudentSubjectStat_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Test" ADD CONSTRAINT "Test_baseConfigId_examStageId_fkey" FOREIGN KEY ("baseConfigId", "examStageId") REFERENCES "BaseConfig"(id, "examStageId") ON DELETE RESTRICT;
ALTER TABLE "Test" ADD CONSTRAINT "Test_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Test" ADD CONSTRAINT "Test_testSeriesId_fkey" FOREIGN KEY ("testSeriesId") REFERENCES "TestSeries"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TestProgramUnlock" ADD CONSTRAINT "TestProgramUnlock_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_paperQuestionId_fkey" FOREIGN KEY ("paperQuestionId") REFERENCES "PaperQuestion"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TestQuestionStat" ADD CONSTRAINT "TestQuestionStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TestSectionStat" ADD CONSTRAINT "TestSectionStat_baseConfigSectionId_fkey" FOREIGN KEY ("baseConfigSectionId") REFERENCES "BaseConfigSection"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TestSectionStat" ADD CONSTRAINT "TestSectionStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_examStageId_fkey" FOREIGN KEY ("examStageId") REFERENCES "ExamStage"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TestStat" ADD CONSTRAINT "TestStat_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "TestStat" ADD CONSTRAINT "TestStat_topperAttemptId_fkey" FOREIGN KEY ("topperAttemptId") REFERENCES "Attempt"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE CONSTRAINT TRIGGER base_config_section_shape_guard AFTER INSERT OR UPDATE ON public."BaseConfigSection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION base_config_section_shape_guard();
CREATE CONSTRAINT TRIGGER base_config_shape_guard AFTER UPDATE OF "timerTemplate" ON public."BaseConfig" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION base_config_shape_guard();
CREATE TRIGGER base_config_guard BEFORE DELETE OR UPDATE ON public."BaseConfig" FOR EACH ROW EXECUTE FUNCTION base_config_guard();
CREATE TRIGGER base_config_module_guard BEFORE INSERT OR DELETE OR UPDATE ON public."BaseConfigModule" FOR EACH ROW EXECUTE FUNCTION base_config_child_guard();
CREATE TRIGGER base_config_module_truncate_guard BEFORE TRUNCATE ON public."BaseConfigModule" FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();
CREATE TRIGGER base_config_section_guard BEFORE INSERT OR DELETE OR UPDATE ON public."BaseConfigSection" FOR EACH ROW EXECUTE FUNCTION base_config_child_guard();
CREATE TRIGGER base_config_section_truncate_guard BEFORE TRUNCATE ON public."BaseConfigSection" FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();
CREATE TRIGGER base_config_truncate_guard BEFORE TRUNCATE ON public."BaseConfig" FOR EACH STATEMENT EXECUTE FUNCTION base_config_truncate_guard();
CREATE TRIGGER paper_question_option_ids BEFORE INSERT OR UPDATE OF "questionVersionId", "optionIds" ON public."PaperQuestion" FOR EACH ROW EXECUTE FUNCTION paper_question_option_ids();
CREATE TRIGGER paper_question_sat_guard BEFORE INSERT OR DELETE OR UPDATE ON public."PaperQuestion" FOR EACH ROW EXECUTE FUNCTION paper_question_sat_guard();
CREATE TRIGGER question_version_sat_guard BEFORE UPDATE ON public."QuestionVersion" FOR EACH ROW WHEN (((old.options IS DISTINCT FROM new.options) OR (old."answerKey" IS DISTINCT FROM new."answerKey") OR (old.content IS DISTINCT FROM new.content))) EXECUTE FUNCTION question_version_sat_guard();
CREATE VIEW "AttemptSheetAnswer" AS
 SELECT sheet."attemptId",
    paper.id AS "paperQuestionId",
    paper."questionId",
    slot."position"::integer AS slot,
    COALESCE((ARRAY['NOT_VISITED'::text, 'NOT_ANSWERED'::text, 'ANSWERED'::text, 'MARKED_REVIEW'::text, 'ANSWERED_MARKED'::text])[((slot.value ->> 0)::integer) + 1], 'NOT_VISITED'::text) AS state,
        CASE jsonb_typeof(slot.value -> 1)
            WHEN 'number'::text THEN paper."optionIds"[((slot.value ->> 1)::integer) + 1]
            WHEN 'string'::text THEN slot.value ->> 1
            ELSE NULL::text
        END AS "selectedOptionId",
    slot.value ->> 5 AS "typedAnswer",
    COALESCE((slot.value ->> 2)::integer, 0) AS "timeSpentSec",
    sitting."startedAt" + make_interval(secs => ((slot.value ->> 3)::integer)::double precision) AS "firstActionAt",
    sitting."startedAt" + make_interval(secs => ((slot.value ->> 4)::integer)::double precision) AS "answeredAt",
    ((sheet.verdicts -> (slot."position"::integer - 1)) ->> 0)::boolean AS "isCorrect",
    ((sheet.verdicts -> (slot."position"::integer - 1)) ->> 1)::numeric AS "marksAwarded"
   FROM "AttemptSheet" sheet
     JOIN "Attempt" sitting ON sitting.id = sheet."attemptId"
     CROSS JOIN LATERAL jsonb_array_elements(sheet.answers) WITH ORDINALITY slot(value, "position")
     JOIN LATERAL ( SELECT row_on_paper.id,
            row_on_paper."questionId",
            row_on_paper."optionIds",
            row_number() OVER (ORDER BY row_on_paper."order") AS "position"
           FROM "PaperQuestion" row_on_paper
          WHERE row_on_paper."testId" = sitting."testId") paper ON paper."position" = slot."position";


