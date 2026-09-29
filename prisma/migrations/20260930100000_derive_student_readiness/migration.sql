-- The readiness flags are derived from StudentProfile on every read (READINESS_FIELDS in
-- packages/contracts), so the stored copies go. Four writers (the admin edit, a document upload,
-- the roster import and erasure) had to restate them by hand, which is how the import once left
-- them false over a full profile and erasure left them set over an emptied one. Nothing moves:
-- the profile columns they were computed from stay, and every reader computes the flags from them.
ALTER TABLE "Student" DROP COLUMN "preTestReady",
DROP COLUMN "profileCompleted";
