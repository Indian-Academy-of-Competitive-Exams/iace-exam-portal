-- ExamTemplate's SSC_RAILWAYS becomes RAILWAYS.
--
-- The skin was ported from the Railway CBT and named for two boards because one screen stood in for
-- both. SSC and Banking are getting skins of their own, copied from their own CBTs, so a value that
-- claims SSC for the Railway screen would sit beside the real SSC one and mean something else.
--
-- RENAME VALUE, not a type rewrite: no row is touched, so the guard that freezes a locked config's
-- skin has nothing to refuse, and every BaseConfig and Test keeps the skin it had under the new name.

ALTER TYPE "ExamTemplate" RENAME VALUE 'SSC_RAILWAYS' TO 'RAILWAYS';
