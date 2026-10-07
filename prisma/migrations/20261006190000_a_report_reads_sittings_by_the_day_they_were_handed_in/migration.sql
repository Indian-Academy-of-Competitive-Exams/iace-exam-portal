-- The reports module's two needs of the schema. Purely additive and nothing moves data, so a
-- from-scratch apply and `db:check` are sufficient proof.
--
-- A weekly or monthly report is the first read of `Attempt` by time alone. Every index the table
-- carried leads with a test or a student, so "the sittings handed in between two days" walked the
-- whole table; this one makes that read as long as the period, not as long as the platform is old.
-- It costs nothing on the sitting's hot path: `submittedAt` is written once, by the submit that
-- already moves `status`, which is indexed and so was never a heap-only update.
--
-- Downloading a report as a spreadsheet is an export like any other and writes its EXPORT audit
-- row, against a feature of its own: a report spans tests, students and staff, and filing it under
-- any one of those would misname the row.

CREATE INDEX "Attempt_submittedAt_idx" ON "Attempt"("submittedAt");

ALTER TYPE "AuditFeature" ADD VALUE 'REPORT';
