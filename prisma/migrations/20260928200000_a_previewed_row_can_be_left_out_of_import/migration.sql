-- A previewed row can be left out of Import from the review window, and brought back. The flag sits on
-- the row's correction, so a row left out after being corrected keeps its correction if it comes back;
-- a row left out without one has no draft, which is why the draft is now nullable. Adds a column with a
-- default and relaxes a NOT NULL: no existing row changes meaning.
ALTER TABLE "ImportRowEdit" ALTER COLUMN "draft" DROP NOT NULL,
    ADD COLUMN "leftOut" BOOLEAN NOT NULL DEFAULT false;
