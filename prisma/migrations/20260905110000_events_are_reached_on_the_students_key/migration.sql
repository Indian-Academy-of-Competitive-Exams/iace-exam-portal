-- Events lost their own feature key: EVENT is gone from the code-owned FEATURE_KEYS,
-- and every events endpoint now gates on STUDENT_MANAGEMENT, like the rest of the
-- student area it belongs to.
--
-- `AdminFeaturePermission.featureKey` is a plain String rather than a database enum,
-- so dropping the key from the code does not fail here — it would quietly leave rows
-- behind that no guard reads and no permissions screen can show or revoke.
--
-- Those rows are deleted rather than converted. STUDENT_MANAGEMENT reaches the whole
-- student directory, imports, branches and the exam catalog, so upgrading an
-- events-only grant in place would hand out far more than anybody chose to give. A
-- super admin grants the wider key deliberately instead.
--
-- No admin held EVENT when this was written, so this matches no rows. It is here so
-- that an environment which did acquire one does not carry a grant nothing can reach.

DELETE FROM "AdminFeaturePermission" WHERE "featureKey" = 'EVENT';
