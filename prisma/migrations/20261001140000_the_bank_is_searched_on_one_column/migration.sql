-- The bank search does not merely get slow on a big bank. It stops working.
--
-- `searchIds` ran a three-branch UNION and returned every matching id, and `questionWhere` fed them
-- back as `{ id: { in: matchedIds } }` — applied to the page query AND to the count. Prisma spends
-- one bind variable per id and the driver caps a statement at 32,767. Measured on a 50K bank:
-- 32,765 ids plus the default status filter is fine, 32,766 raises
--   "too many bind variables in prepared statement, expected maximum of 32767, received 32768".
-- `q` is capped at 64 characters with NO minimum, so `q=a` is a legal request. On a 50K bank any
-- common term — a, the, of — 500s the question list and the export outright. The export's own cap
-- never gets to refuse it, because the count that feeds the cap is the query that throws.
--
-- The UNION could not become a Prisma predicate, which is why the ids were on the wire at all:
-- path-less `string_contains` emits the indexed expression and then adds
-- `JSONB_TYPEOF("content") = 'string'`, which matches nothing for an object; `mode: 'insensitive'`
-- on jsonb is the hard error `function lower(jsonb) does not exist`; `tagsText(tags) ILIKE` has no
-- Prisma form at all. And an OR across the three was measured WORSE than the UNION: Prisma renders
-- a to-one relation filter as a LEFT JOIN, so the OR spans the join, no BitmapOr is possible, and
-- the count seq-scans both tables for every term including one that matches nothing (153ms flat).
--
-- So the text moves to where a predicate can reach it. "Question"."searchText" holds the current
-- version's content, the question code and the tags as one string, trigger-maintained, and the
-- search becomes `{ searchText: { contains: term, mode: 'insensitive' } }` — one relation, one
-- branch, no ids on the wire, no bind ceiling, and the page query and the count apply it
-- identically. Measured on the same 50K bank: q=a 0.09ms, q=triangle 0.23ms, q=zzzzz 0.06ms for
-- the page; the worst count is 71.6ms at 98% selectivity, where the planner correctly abandons the
-- index. Against 169ms of work that never completed.
--
-- Two things the stored text fixes beyond the ceiling:
--
-- Content is escaped html, so "Ram & Shyam" sits in it as "Ram &amp; Shyam" and the old search had
-- to escape the term to match it — while a tag is stored raw, so the SAME escaping made the tag
-- branch miss. One column cannot be matched two ways, so the text is stored DECODED: the markup is
-- stripped and &lt; &gt; &amp; are turned back into < > &. The term now goes in exactly as typed
-- and matches all three sources the same way. Stripping tags is unambiguous precisely because the
-- content is escaped: a real < in the text is `&lt;` at that moment, so `<[^>]*>` can only ever be
-- markup.
--
-- And `%p>%` used to match every question with a paragraph in it. Now the markup is not there to
-- match. Reach is otherwise unchanged: stem and solution, as before — option text lives in
-- "options" and was never searched.
--
-- The backfill is `SET "searchText" = "searchText"`, which fires the BEFORE trigger on every row
-- rather than restating the expression. Same pattern as the backfill in 20260917100000 and the
-- fan-out in 20260918140000. "searchText" is in the trigger's UPDATE OF list for exactly this
-- reason, which also means the column cannot be hand-set: any write to it is recomputed.
--
-- The three trigram indexes this replaces are dropped. Each had exactly one reader — a branch of
-- the UNION — verified by grep across apps/ and packages/ before writing this, and
-- Question_questionCode_trgm_idx could not serve its own branch anyway, because
-- `{ contains, mode: 'insensitive' }` emits LOWER("questionCode") against an index on the bare
-- column. They were three GIN indexes maintained on every question write for one query that threw.
--
-- The new index is on the bare column, because `{ contains, mode: 'insensitive' }` on Prisma 6.19
-- emits `"searchText" ILIKE $1` — not the `LOWER(col) LIKE LOWER($1)` an older version emitted, and
-- not what this was first written against. pg_trgm's GIN opclass serves ILIKE on the column
-- directly, so an index on `lower("searchText")` would have been built, maintained, and never once
-- used. Verified on a seeded database by reading the SQL off the query log and then the plan:
-- Bitmap Index Scan on Question_searchText_trgm_idx. Being a plain column index it also lives in
-- schema.prisma, so `pnpm db:check` can see it — unlike the two expression indexes dropped below.

ALTER TABLE "Question" ADD COLUMN "searchText" text;

CREATE FUNCTION "questionSearchText"(content jsonb, code text, tags text[])
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT concat_ws(' ',
    code,
    "tagsText"(tags),
    replace(replace(replace(
      regexp_replace(coalesce(content::text, ''), '<[^>]*>', ' ', 'g'),
      '&lt;', '<'), '&gt;', '>'), '&amp;', '&'))
$$;

CREATE FUNCTION question_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := "questionSearchText"(
    (SELECT v."content" FROM "QuestionVersion" v WHERE v."id" = NEW."currentVersionId"),
    NEW."questionCode",
    NEW."tags");
  RETURN NEW;
END $$;

CREATE TRIGGER question_search_text
  BEFORE INSERT OR UPDATE OF "currentVersionId", "questionCode", "tags", "searchText"
  ON "Question"
  FOR EACH ROW
  EXECUTE FUNCTION question_search_text();

CREATE FUNCTION question_version_search_text_fanout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Question" SET "searchText" = "searchText" WHERE "currentVersionId" = NEW."id";
  RETURN NULL;
END $$;

CREATE TRIGGER question_version_search_text_fanout
  AFTER UPDATE OF "content" ON "QuestionVersion"
  FOR EACH ROW
  WHEN (OLD."content" IS DISTINCT FROM NEW."content")
  EXECUTE FUNCTION question_version_search_text_fanout();

UPDATE "Question" SET "searchText" = "searchText";

CREATE INDEX "Question_searchText_trgm_idx"
  ON "Question" USING gin ("searchText" gin_trgm_ops);

DROP INDEX "QuestionVersion_content_trgm_idx";
DROP INDEX "Question_questionCode_trgm_idx";
DROP INDEX "Question_tags_trgm_idx";
