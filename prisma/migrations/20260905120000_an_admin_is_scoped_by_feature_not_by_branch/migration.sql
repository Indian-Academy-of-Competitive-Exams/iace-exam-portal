-- Branch-scoped admins are gone. An admin is a super admin or not, and "not" means the
-- feature keys they hold — never a narrower set of students, branches or reports.
--
-- This is the last of the shape that BranchTestConfig and BranchTestSchedule already left
-- when a series took over naming its own branches. Nothing reads these two any more: the
-- code that did was removed in the commit before this one, so the API and both SPAs have
-- already been running without them.
--
-- Both statements DESTROY data, and neither can be undone by re-running the migration in
-- reverse: the AdminBranch rows say which branches each admin was given, and allBranches
-- says whether they bypassed that list. Restoring branch scoping later means re-creating
-- the table and asking a super admin to fill it in again. That is accepted — the platform
-- has not launched, and every student row still carries currentBranchId, which is the part
-- that would have been expensive to reconstruct.
--
-- Branch itself is untouched. Students still belong to one, a series still names the ones
-- it runs for, and the leaderboard still shows it.

DROP TABLE "AdminBranch";

ALTER TABLE "Admin" DROP COLUMN "allBranches";
