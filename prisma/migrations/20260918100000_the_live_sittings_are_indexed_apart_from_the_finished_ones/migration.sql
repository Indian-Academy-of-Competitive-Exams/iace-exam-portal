-- Page-level storage only: two partial indexes, one index dropped, a fillfactor and vacuum settings.
-- No column, constraint or data change.
--
-- Measured on a throwaway copy of this schema holding 21 exams: 100,000 evaluated sittings, 5,000 in
-- progress, 100,000 outbox events. Pages and WAL are counted by Postgres itself (EXPLAIN BUFFERS /
-- WAL), so they do not depend on the machine.
--
-- 1. THE SWEEPER READ THE WHOLE TABLE, EVERY TWO MINUTES.
--    It asks for IN_PROGRESS sittings past their deadline across all tests, and no index started
--    with "status" or "endsAt", so its usual run -- the one that finds nothing overdue and cannot
--    stop early -- was a sequential scan: 7,815 pages and 15.7 ms at 105,000 sittings, against 2
--    pages and 0.005 ms with the index below. That cost grows with the table while the number of
--    live sittings does not, and at 720 runs a day it cycles the whole table through the cache.
--
--    Both new indexes hold ONLY live sittings -- a few thousand rows at most, whatever the history
--    grows to -- so they stay small and stay in memory. A sitting leaves the index by being
--    submitted, which is the same write that already moves it in [testId, status].
--
--    The per-test one serves the live-ops hall (running and overdue counts): 129 pages and 0.9 ms
--    became 3-7 pages and 0.07-0.25 ms.
--
-- 2. [testId, score] IS REDUNDANT.
--    Attempt_ranking_idx is (testId, score DESC, timeTakenSec, id) over graded, evaluated, scored
--    sittings, and it already serves the topper and standings reads (4 pages either way, measured
--    with the index dropped). Carrying it cost 6.5 MB per 105,000 sittings and an entry in every
--    non-HOT update: dropping it took one exam's writes from 26.45 MB of WAL to 24.51 MB.
--
--    [testId, status] STAYS. Cohort reads (rollups, analytics, the unscored count) ask for a test's
--    EVALUATED or SUBMITTED sittings, and only this index serves them: the ranking index covers
--    graded scored rows alone.
--
-- 3. FILLFACTOR 70 ON THE ANSWER SHEETS, was 50.
--    A sheet is rewritten about 25 times while the paper is being sat and never again, so its page
--    room is reserved forever for updates that stopped coming. Through a whole 100-question exam:
--    at 50 the table was 14.85 MB per 5,000 sittings with 97.4% of updates staying on their page;
--    at 70, 13.02 MB and 96.2%. WAL was identical (74.4 against 74.5 MB) because the table carries
--    one index, so a move costs almost nothing. Existing pages keep the old setting; this decides
--    how pages are filled from here on.
--
-- 4. VACUUM ON "Attempt" ON A FIXED THRESHOLD, not a percentage.
--    Autovacuum's default waits for dead rows worth 20% of the table: 21,000 at today's size and
--    600,000 after a year, while scoring an exam of 5,000 leaves about 15,000. Until it runs, the
--    pages it would mark all-visible are not, and every standing read fetches each cohort row from
--    the table: 5,044 pages against 80 for one student's standing, 1.0 ms against 0.58 ms. The
--    vacuum that fixes it took 9 ms, because pages already marked are skipped. 5,000 students
--    opening their results is the difference between 25 million page reads and 400,000.
--    The insert threshold matters for the same reason: starting an exam adds 5,000 unmarked rows.

CREATE INDEX "Attempt_live_by_test_idx" ON "Attempt" ("testId", "endsAt") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "Attempt_expiring_idx" ON "Attempt" ("endsAt") WHERE "status" = 'IN_PROGRESS';

DROP INDEX "Attempt_testId_score_idx";

ALTER TABLE "AttemptSheet" SET (fillfactor = 70);

ALTER TABLE "Attempt" SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 5000
);
