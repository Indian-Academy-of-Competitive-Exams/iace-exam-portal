-- Moves "Attempt"."sectionScores" from an array of objects to an array of arrays:
--   [{"baseConfigSectionId": "c...", "score": 68.25, "correctCount": 42, "wrongCount": 10,
--     "unattemptedCount": 18, "timeSpentSec": 700}, ...]
-- becomes
--   [["c...", 68.25, 42, 10, 18, 700], ...]
--
-- Same numbers, same order, same section id. What goes is the field names, which were repeated for
-- every section of every sitting: about 200 of the 383 bytes the column averaged. Measured on a
-- copy holding 105,000 sittings of a two-section paper, the value fell to 151 bytes and the whole
-- Attempt table from 61.05 MB to 38.16 MB, because the row is only ~580 bytes to begin with. A
-- cohort read then touches 245 pages instead of 390, and a full scan 4,884 instead of 7,815.
--
-- The section id STAYS in each entry. Dropping it too would save another ~60 bytes a section, but
-- then decoding needs the blueprint's section order, and the readers that span tests (a student's
-- performance across sittings, the topper comparison) would each have to load it per test.
--
-- apps/api/src/attempts/score-paper.ts owns both directions: packedSections writes, sectionScoresIn
-- reads, and every reader already goes through sectionScoresIn. Rows still in the old shape after
-- this are not read as sections at all, so nothing half-converted can reach a score card.
--
-- Rehearsed on a scratch database seeded at the previous revision with scored sittings: every row
-- converted, none left an object, and the score card read back the same section marks.

UPDATE "Attempt" SET "sectionScores" = (
  SELECT jsonb_agg(
    jsonb_build_array(
      entry ->> 'baseConfigSectionId',
      entry -> 'score',
      entry -> 'correctCount',
      entry -> 'wrongCount',
      entry -> 'unattemptedCount',
      entry -> 'timeSpentSec'
    )
    ORDER BY ord
  )
  FROM jsonb_array_elements("sectionScores") WITH ORDINALITY AS section(entry, ord)
)
WHERE jsonb_typeof("sectionScores") = 'array'
  AND jsonb_typeof("sectionScores" -> 0) = 'object';
