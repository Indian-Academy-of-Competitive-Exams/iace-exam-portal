-- Searching the bank for "stem", "solution" or "text" listed every question in it.
--
-- 20261001140000 built "Question"."searchText" from `content::text` with the markup stripped. But
-- `content` is not prose, it is the whole document:
--   {"en": {"stem": [{"text": "<p>...</p>", "type": "TEXT"}], "solution": [...]}, "hi": {...}}
-- so its serialisation carried the JSON's own vocabulary into every row: the key names `stem`,
-- `solution`, `text` and `type`, the literal `TEXT`, and each language code. Measured on a
-- 50,005-row bank before this ran: "stem", "text" and "type" each matched 50,004 rows and
-- "solution" 50,002 -- every row that has a version, whatever it says.
--
-- The serialisation leaked its ESCAPING too. A quotation mark in a stem was stored as `\"` and a
-- backslash as `\\`, so a search for the words either side of one, typed as the admin reads them,
-- missed. Same cause, same cure.
--
-- "questionSearchText" now reads the VALUES and nothing else: the `text` of every node, of every
-- field, of every language, unquoted by `#>> '{}'`. The path is `$.*.*[*].text` -- any language,
-- any field under it (stem, solution), every node, its text -- so a language added later is
-- searched without touching this, and a node type that carries no `text` contributes nothing.
-- jsonpath's default lax mode yields no rows for a shape the path does not fit rather than raising,
-- so a row with no version, or content of some other shape, keeps its code and tags and nothing
-- else. Reach is unchanged: stem and solution in every language, the code, the tags. Option text
-- lives in "options" and is still not searched.
--
-- Stripping the markup and decoding &lt; &gt; &amp; are exactly as 20261001140000 left them.
--
-- The function keeps its name and signature, so CREATE OR REPLACE swaps the body under the trigger
-- that calls it and no trigger is redefined. `jsonb_path_query` is IMMUTABLE and PARALLEL SAFE, so
-- the function's own markings still hold. Nothing in schema.prisma moves: same column, same index,
-- and the list query reads the column exactly as before.
--
-- THE DATA MOVE. "searchText" is a stored copy, so replacing the function changes nothing already
-- written: every row has to be recomputed. The rebuild is the statement the original backfill
-- used, `SET "searchText" = "searchText"`, which fires the BEFORE trigger question_search_text on
-- every row ("searchText" is in its UPDATE OF list for exactly this) and lets it read the current
-- version and write the new text.
--
-- No guard stands down for it, because none is in its way. What freezes a sat paper lives on
-- "QuestionVersion" (question_version_sat_guard: options, answerKey, content) and on
-- "PaperQuestion" (paper_question_sat_guard). This writes to neither. It updates "Question" only,
-- whose one trigger is the search trigger itself, and the column it changes is derived text that
-- no paper and no sitting reads. Proved on a database migrated to the previous revision and seeded
-- with a sat paper pinning two of the rows: all 50,005 were rebuilt, the 14 triggers enabled
-- before are the same 14 enabled after, and the version guard still refuses an edit to a pinned
-- version.
--
-- It is raw SQL, so "updatedAt" does not move -- Prisma sets it client-side -- and an editor
-- holding a question open across the deploy is not refused a save for a row nobody edited.
--
-- Cost: one UPDATE over N rows. Each row is a primary-key read of its current version and a new
-- heap tuple with an entry in every index on "Question", the trigram one dominating. Measured on
-- 50,005 rows of the worst text there is for a trigram index (random hex): 10.0s in psql, 11.7s
-- through `prisma migrate deploy`. About 0.2ms a row, and linear in the size of the bank.
--
-- The index stays in place on purpose. Dropping it, updating and building it again measured the
-- same total (2.7s + 7.5s) but holds ACCESS EXCLUSIVE on "Question" throughout, which blocks every
-- reader of the bank; the UPDATE alone blocks only a concurrent save of the same question. The
-- entries it supersedes are dead space that autovacuum reclaims.

CREATE OR REPLACE FUNCTION "questionSearchText"(content jsonb, code text, tags text[])
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT concat_ws(' ',
    code,
    "tagsText"(tags),
    replace(replace(replace(
      regexp_replace(
        (SELECT string_agg(node #>> '{}', ' ')
           FROM jsonb_path_query(content, '$.*.*[*].text') AS node),
        '<[^>]*>', ' ', 'g'),
      '&lt;', '<'), '&gt;', '>'), '&amp;', '&'))
$$;

UPDATE "Question" SET "searchText" = "searchText";
