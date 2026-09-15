-- Programs and events get their own audit feature.
--
-- A program's create, edit and delete were filed under STUDENT, so the log read "Student Created"
-- over an id no student carries. Events were not audited at all: creating one, renaming it, retiring
-- it or changing its roster — which decides who reaches every series built on it — left no row.
--
-- Values are only added, never renamed or removed, so every existing row keeps the feature it was
-- written with. Rows already filed under STUDENT for a program stay there: the log is a record of
-- what was written at the time, and nothing in a row tells a program's id apart from a deleted one.

-- AlterEnum
ALTER TYPE "AuditFeature" ADD VALUE 'PROGRAM';
ALTER TYPE "AuditFeature" ADD VALUE 'EVENT';
