-- ExamTemplate gains SSC: the screen SSC mocks are sat on, with the clock in the header, the four
-- buttons above the question and the palette on the right.
--
-- A new value only. No row carries it until an admin picks it, so nothing is moved and the guard that
-- freezes a locked config's skin is not involved.

ALTER TYPE "ExamTemplate" ADD VALUE 'SSC';
