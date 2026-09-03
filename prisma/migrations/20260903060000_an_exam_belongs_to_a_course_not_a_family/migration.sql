-- An exam belongs to a COURSE, not a family.
--
-- "Family" was our word, not the exam world's. IACE sells courses — an SSC course,
-- a Banking course — and a student enrols in one. Nobody at a branch has ever
-- called it a family, so every screen had to translate on the way in and out.
--
-- This is a pure rename. Not one row moves, and not one value changes: the enum
-- still reads SSC / RRB / BANKING / AP_TS_POLICE, and every student keeps exactly
-- the enrolments they had. RENAME is what makes that true — Postgres rewrites the
-- catalog entry in place, so the data, the array type, the GIN index and every
-- dependent object come along without being rebuilt.
--
-- Prisma would not have written it this way. Left to itself it sees a dropped
-- column beside a new one and generates DROP + ADD, which is the same shape as
-- this and loses every enrolment in the database. That is why this file is by
-- hand, and why it must not be regenerated.
--
-- The two indexes are renamed for the same reason the columns are: Prisma derives
-- their names from the columns, so leaving them would make the next `db:check`
-- report drift that is not there.

ALTER TYPE "ExamFamily" RENAME TO "ExamCourse";

ALTER TABLE "Exam" RENAME COLUMN "family" TO "course";
ALTER TABLE "Student" RENAME COLUMN "enrolledFamilies" TO "enrolledCourses";

ALTER INDEX "Exam_family_idx" RENAME TO "Exam_course_idx";
ALTER INDEX "Student_enrolledFamilies_idx" RENAME TO "Student_enrolledCourses_idx";
