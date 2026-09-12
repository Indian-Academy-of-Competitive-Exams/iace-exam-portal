-- A series name is unique across the platform, and a test's name is unique inside its series.
--
-- Neither was enforced anywhere: the suggested name numbered past its siblings, but an admin
-- could type straight over it, and two series called "SSC CGL Tier 1 — Mock Test Series" would
-- both save. The admin picking a series from a dropdown, and the student reading their list,
-- then had two identical rows and no way to tell them apart.
--
-- Case-insensitive, because a constraint that lets "Mock 01" and "mock 01" coexist is one the
-- reader experiences as broken. Not trimmed here: every write goes through a Zod schema that
-- trims, so a stored name with edge whitespace cannot have come from the API.
--
-- A test with NO name is left alone. `title` is nullable for a draft nobody has named yet, and
-- NULLs are distinct in a Postgres unique index, so a series may hold as many untitled drafts
-- as it likes -- which is what the builder creates before its first save.
--
-- THE DATA MOVE: an existing duplicate is RENAMED, never dropped. The oldest row of a colliding
-- set keeps the name it has and every later one is numbered, so "Mock 1" three times over comes
-- out as "Mock 1", "Mock 1 02", "Mock 1 03".
--
-- Two set-based passes, not a loop that probes for the first free suffix. The probing version was
-- written first and had to be killed after ten minutes against a database holding a few hundred
-- same-named rows: it is one table scan per candidate suffix per row, which is quadratic and only
-- looks fast on a table with nothing wrong with it. The second pass exists because the first can
-- rename a row onto a name somebody else already holds -- "Mock 1" numbered to "Mock 1 02" where
-- a "Mock 1 02" was already there -- and it settles those with the row's own id, which no other
-- row can carry. Anything still colliding after that fails the CREATE UNIQUE INDEX below, loudly,
-- which is the right way for a case nobody anticipated to surface.

UPDATE "TestSeries" s
SET name = s.name || ' ' || lpad(d.rn::text, 2, '0')
FROM (
  SELECT id, row_number() OVER (PARTITION BY lower(name) ORDER BY "createdAt", id) AS rn
  FROM "TestSeries"
) d
WHERE s.id = d.id AND d.rn > 1;

UPDATE "TestSeries" s
SET name = s.name || ' (' || s.id || ')'
FROM (
  SELECT id, row_number() OVER (PARTITION BY lower(name) ORDER BY "createdAt", id) AS rn
  FROM "TestSeries"
) d
WHERE s.id = d.id AND d.rn > 1;

UPDATE "Test" s
SET title = s.title || ' ' || lpad(d.rn::text, 2, '0')
FROM (
  SELECT id,
         row_number() OVER (PARTITION BY "testSeriesId", lower(title) ORDER BY "createdAt", id) AS rn
  FROM "Test"
  WHERE title IS NOT NULL
) d
WHERE s.id = d.id AND d.rn > 1;

UPDATE "Test" s
SET title = s.title || ' (' || s.id || ')'
FROM (
  SELECT id,
         row_number() OVER (PARTITION BY "testSeriesId", lower(title) ORDER BY "createdAt", id) AS rn
  FROM "Test"
  WHERE title IS NOT NULL
) d
WHERE s.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX "TestSeries_name_key" ON "TestSeries" (lower("name"));

CREATE UNIQUE INDEX "Test_testSeriesId_title_key" ON "Test" ("testSeriesId", lower("title"));
