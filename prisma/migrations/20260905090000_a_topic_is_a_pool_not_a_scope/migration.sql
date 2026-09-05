-- TestScope loses TOPIC, because a topic was never a kind of test.
--
-- Every test already narrows what it draws from per section, through Test.questionPoolFilter, whose
-- SectionDrawSpec carries topicIds. A TOPIC scope was a second way to say the same thing, and the two
-- never agreed on who won: the scope named topics for the whole test while the pool named them per
-- section, and only the pool was ever read by the draw. So the scope goes and the pool stays.
--
-- The topics a TOPIC test named are NOT dropped. They move to where topics now live: the pool spec of
-- every section of that test's configuration, so a paper drawn afterwards draws from the same topics it
-- would have before. Where a section already names its own topics the section wins and is left alone --
-- it is the narrower, more deliberate statement, and widening it to the test's list would change what
-- that section draws.
--
-- Anything already merged keeps its meaning: FULL, MODULE and SECTIONAL are untouched, and
-- StudentSubjectStat.scope shares the type only as a label on a rollup, so narrowing it costs nothing
-- there beyond the rewrite the type change forces.

-- ---------------------------------------------------------------------------
-- Step 1: carry each TOPIC test's topics into the pool spec, section by section.
-- ---------------------------------------------------------------------------
UPDATE "Test" t
SET "questionPoolFilter" = jsonb_build_object(
      'sections',
      COALESCE(t."questionPoolFilter"->'sections', '{}'::jsonb) || (
        SELECT COALESCE(
                 jsonb_object_agg(
                   s."id",
                   -- Merged, not replaced: a section already naming a mix keeps it and gains the topics.
                   COALESCE(t."questionPoolFilter"->'sections'->s."id", '{}'::jsonb)
                     || jsonb_build_object('topicIds', t."scopeRef"->'topicIds')
                 ),
                 '{}'::jsonb
               )
        FROM "BaseConfigSection" s
        WHERE s."baseConfigId" = t."baseConfigId"
          AND COALESCE(t."questionPoolFilter"->'sections'->s."id"->'topicIds', 'null'::jsonb) = 'null'::jsonb
      )
    )
WHERE t."scope" = 'TOPIC'
  AND jsonb_typeof(t."scopeRef"->'topicIds') = 'array'
  AND jsonb_array_length(t."scopeRef"->'topicIds') > 0;

-- ---------------------------------------------------------------------------
-- Step 2: a topic test becomes what it always was underneath -- a full paper, drawn from those topics.
-- ---------------------------------------------------------------------------
UPDATE "Test" SET "scope" = 'FULL', "scopeRef" = NULL WHERE "scope" = 'TOPIC';

-- ---------------------------------------------------------------------------
-- Step 3: narrow the type. Both columns that carry it are rewritten in the same transaction.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TYPE "TestScope_new" AS ENUM ('FULL', 'MODULE', 'SECTIONAL');
ALTER TABLE "Test" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "Test" ALTER COLUMN "scope" TYPE "TestScope_new" USING ("scope"::text::"TestScope_new");
ALTER TABLE "Test" ALTER COLUMN "scope" SET DEFAULT 'FULL';
ALTER TABLE "StudentSubjectStat" ALTER COLUMN "scope" TYPE "TestScope_new" USING ("scope"::text::"TestScope_new");
ALTER TYPE "TestScope" RENAME TO "TestScope_old";
ALTER TYPE "TestScope_new" RENAME TO "TestScope";
DROP TYPE "TestScope_old";
COMMIT;
