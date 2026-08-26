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

ALTER TABLE "BaseConfigSection" ADD COLUMN "patternNote" TEXT;

UPDATE "BaseConfigSection"
   SET "patternNote" = "difficultyMix" ->> 'indicative'
 WHERE "difficultyMix" IS NOT NULL;

ALTER TABLE "BaseConfigSection" DROP COLUMN "difficultyMix";
