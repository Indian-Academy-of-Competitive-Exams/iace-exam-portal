-- The admin dashboard stops scanning the bank to count it by status.
--
-- `questionsByStatus` groups every question by status with no predicate, on every dashboard load.
-- `Question` carries `(subjectId, difficulty, status)`, which holds the column but not in front, so
-- the aggregate fell back to a sequential scan of the whole table.
--
-- Measured on 50,000 questions: 468 buffers to 45, and an Index Only Scan with no heap fetches.
-- Small in absolute terms, and it is a request path that grows with the bank rather than the load.

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "Question"("status");
