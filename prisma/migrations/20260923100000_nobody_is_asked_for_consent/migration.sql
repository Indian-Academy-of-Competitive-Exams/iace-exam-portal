-- Drops "StudentConsent" and the "ConsentPurpose" enum. No other table referenced them.
--
-- The platform never asked. The API carried GET and POST /me/consent and wrote a record when a
-- student signed up, but no screen in either SPA or the mobile client reached those routes, and
-- the typed client had no method for them — so every row said only that an account was created,
-- which the account itself already says.
--
-- What this removes is evidence, not a right: the copy a student may take away and erasure as
-- anonymisation both stay. If a privacy notice later has to be accepted on screen, this table
-- comes back with the screen that fills it, and CONSENT_VERSION with it.

DROP TABLE "StudentConsent";
DROP TYPE "ConsentPurpose";
