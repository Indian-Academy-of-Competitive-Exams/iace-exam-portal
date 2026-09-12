-- A series is no longer marked as a graded ramp.
--
-- `progressive` said "each paper is harder than the last", and the one thing it bought was a pair
-- of figures on the student's series screen: percentile against each paper's graded difficulty,
-- and each subject's accuracy across the same ordered papers. The institute does not grade its
-- series that way, so the flag was never going to be set and the figures never going to be drawn.
--
-- Both figures go with it, along with the `progression` branch of the performance report. Nothing
-- read this column but that one feature, so there is nothing to move anywhere.

ALTER TABLE "TestSeries" DROP COLUMN "progressive";
