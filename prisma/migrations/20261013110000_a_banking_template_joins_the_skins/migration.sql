-- ExamTemplate gains BANKING: the IBPS-style screen bank exams are sat on, with section tabs across
-- the top, the clock beside them and the palette on the right.
--
-- A new value only. No row carries it until an admin picks it, so nothing is moved and the guard that
-- freezes a locked config's skin is not involved.

ALTER TYPE "ExamTemplate" ADD VALUE 'BANKING';
