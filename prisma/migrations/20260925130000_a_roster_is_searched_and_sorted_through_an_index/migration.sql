-- The roster search and the roster sort stop being scans.
--
-- `studentWhere` matches `fullName` and `mobile` with a leading-wildcard ILIKE/LIKE, which a
-- btree cannot serve; pg_trgm (already enabled by the bank-search migration) indexes the
-- trigrams instead, mirroring Question_questionCode_trgm_idx. The attempt list's search on
-- `test.title` (tests.service.ts, students.service.ts, live-ops.ts) gets the same treatment.
--
-- `studentOrderBy` sorts by (fullName ASC NULLS LAST, id ASC) and (createdAt DESC, id DESC). A
-- plain ascending btree serves both directions of each pair: Postgres scans it forward for the
-- ASC case and backward for the DESC one, and ASC's default NULLS LAST already matches the name
-- sort, so one index per pair is enough — no DESC-declared index needed.
--
-- RowActionLog's list filters (audit.service.ts) are all exact-match (`in`, equality) plus a
-- date range, never a `contains` — it gets no trigram index here.

CREATE INDEX "Student_fullName_trgm_idx" ON "Student" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX "Student_mobile_trgm_idx" ON "Student" USING GIN ("mobile" gin_trgm_ops);

CREATE INDEX "Student_fullName_id_idx" ON "Student"("fullName", "id");

CREATE INDEX "Student_createdAt_id_idx" ON "Student"("createdAt", "id");

CREATE INDEX "Test_title_trgm_idx" ON "Test" USING GIN ("title" gin_trgm_ops);
