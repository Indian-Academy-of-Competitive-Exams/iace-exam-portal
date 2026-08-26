-- BaseConfigSection.difficultyMix was never a difficulty mix.
--
-- It was seeded from the exam-pattern workbook with prose — {"indicative": "Moderate-Difficult"} —
-- and no application code has ever read it. The mix that governs a draw and now caps hand-picking
-- is DifficultyMix, three integers, and it lives on Test.questionPoolFilter per section. Two
-- different things wearing one name is how the next person wires defaultMixFor to a sentence.
--
-- Renamed to patternNote and flattened to the text it always was, keeping the workbook's words:
-- they are reference an exam controller recognises, and losing them would lose the only trace of
-- what the paper is supposed to feel like.

-- Two guards sit on this table and both have to stand down for the data move.
--
-- base_config_section_guard refuses ANY update to a section whose config is locked. It is
-- row-level, so it cannot tell a shape change from this one, and a database where somebody has
-- built a test is a database where at least one config is locked.
--
-- base_config_section_shape_guard is DEFERRABLE INITIALLY DEFERRED: left enabled it queues an
-- event per updated row, and the ALTER TABLE that follows then fails with "pending trigger
-- events" rather than anything about shape. Disabling it BEFORE the update queues nothing.
--
-- Moving a note between two columns is not a shape change: the same words end up on the same
-- section, and nothing a locked config promises about marks, timing or counts moves.

ALTER TABLE "BaseConfigSection" ADD COLUMN "patternNote" TEXT;

ALTER TABLE "BaseConfigSection" DISABLE TRIGGER "base_config_section_guard";
ALTER TABLE "BaseConfigSection" DISABLE TRIGGER "base_config_section_shape_guard";

UPDATE "BaseConfigSection"
   SET "patternNote" = "difficultyMix" ->> 'indicative'
 WHERE "difficultyMix" IS NOT NULL;

ALTER TABLE "BaseConfigSection" ENABLE TRIGGER "base_config_section_shape_guard";
ALTER TABLE "BaseConfigSection" ENABLE TRIGGER "base_config_section_guard";

ALTER TABLE "BaseConfigSection" DROP COLUMN "difficultyMix";
