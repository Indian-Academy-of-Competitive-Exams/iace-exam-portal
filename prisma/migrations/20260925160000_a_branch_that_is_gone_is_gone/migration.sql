-- Branch was modelled for soft delete -- `deletedAt`, and `Branch_name_live_key` as a unique index
-- scoped to WHERE "deletedAt" IS NULL -- but no code path has ever set the column: remove() in
-- apps/api/src/branches/branches.service.ts has always been a hard `branch.delete`. The predicate
-- was therefore always true, and the partial unique has only ever behaved as a plain one.
-- `isActive` already carries the real "a retired branch takes no new students" rule
-- (docs/02-domain-rules.md §5); `deletedAt` was a second, unused mechanism doing nothing.
--
-- `Branch_name_live_key` is a partial index, which Prisma's schema has no syntax for and its
-- migrate-diff engine does not manage -- it is dropped here by hand, or it would survive every
-- future `prisma migrate diff` untouched. `Branch_name_idx`, the plain non-unique index the schema
-- did track, is superseded by the plain unique index below and is dropped the ordinary way.
DROP INDEX "Branch_name_live_key";
DROP INDEX "Branch_name_idx";

ALTER TABLE "Branch" DROP COLUMN "deletedAt";

CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
