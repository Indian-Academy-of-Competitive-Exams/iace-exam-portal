-- The stat-drift sweep stops reading every attempt row from the heap.
--
-- `driftedStudents` runs on every pass -- every two minutes, for ever -- and asks, per student,
-- whether any evaluated sitting of theirs has moved since their totals were counted. The only index
-- with `studentId` in front is `(studentId, createdAt)`, and neither `status` nor `updatedAt` is in
-- it, so each student's sittings had to be fetched from the heap to test the predicate.
--
-- The LIMIT does not rescue it. In the steady state nothing has drifted, so there is no early row
-- to stop at: the semi-join must look at every student and every sitting to return nothing. That is
-- the normal case, not the exception, and it was the most expensive query in the repo by pages read.
--
-- Measured on 10,000 students with five sittings each: the attempt side falls from 50,094 buffers
-- to 95, and becomes an Index Only Scan with no heap fetches at all.
--
-- Partial, and by hand because Prisma cannot write a WHERE on an index. `status = 'EVALUATED'` is
-- the only status the sweep asks about, so a hall mid-sitting adds nothing to this index and the
-- rows that are in it are exactly the rows it reads.

CREATE INDEX "Attempt_student_drift_idx"
  ON "Attempt" ("studentId", "updatedAt")
  WHERE "status" = 'EVALUATED';
