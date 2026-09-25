-- The question search stops being a scan of the whole bank.
--
-- `searchIds` matches three things with a LEADING-wildcard ILIKE: the version's `content` cast to
-- text, the question code, and each tag. A leading wildcard is unindexable with a btree, so every
-- one of those was a sequential scan, and the content one cast jsonb to text once per row on the
-- way past. It runs when an admin types in a search box.
--
-- pg_trgm indexes trigrams rather than prefixes, which is exactly what `%term%` needs. The content
-- index is on the SAME expression the query matches -- `content::text`, JSON punctuation and all --
-- because the query has always matched the raw serialisation, and narrowing it now would silently
-- change which questions a search finds.
--
-- All three matter because they are ORed together. Postgres can answer an OR from several indexes
-- with a BitmapOr, but only if EVERY branch is indexable: one branch that is not turns the whole
-- thing back into the scan the other two were meant to prevent. That is why tags are here too.
--
-- Tags could not be indexed as written. `EXISTS (SELECT 1 FROM unnest(tags) WHERE tag ILIKE ...)`
-- has no expression to index, and `array_to_string` is STABLE rather than IMMUTABLE -- it is
-- polymorphic, so it inherits the weakest guarantee of any element type it might be given. Pinned
-- to `text[]`, whose output function is immutable, it is safe, and `tagsText` is that pinning.
--
-- It joins on a COMMA, not a space. A tag is `[a-z0-9]+( [a-z0-9]+)*` -- lowercase words with
-- single spaces -- so a tag may contain a space but never a comma. Joining on a space would let
-- `%alpha beta%` match a question tagged `alpha` and `beta` separately, which per-element matching
-- never did; joining on a character no tag can hold means reaching across a boundary requires
-- typing that character, and a search containing a comma matches no single tag anyway.
--
-- GIN over GIST: this is read-mostly, and GIN answers `%term%` faster. The write cost lands on
-- question edits, which are rare and already inside a transaction doing more work than this.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION "tagsText"(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT array_to_string($1, ',') $$;

CREATE INDEX "QuestionVersion_content_trgm_idx"
  ON "QuestionVersion" USING gin (("content"::text) gin_trgm_ops);

CREATE INDEX "Question_questionCode_trgm_idx"
  ON "Question" USING gin ("questionCode" gin_trgm_ops);

CREATE INDEX "Question_tags_trgm_idx"
  ON "Question" USING gin (("tagsText"("tags")) gin_trgm_ops);
