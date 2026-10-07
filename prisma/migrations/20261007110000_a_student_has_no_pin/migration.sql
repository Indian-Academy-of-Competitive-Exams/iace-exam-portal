-- A student signs in with a code sent to their mobile, every time. There is no PIN.
--
-- The PIN existed so that a sign-in cost no SMS: a code once at signup, four digits after. It also
-- meant a roster import had to mint a PIN for every student and text it to them, that a PIN nobody
-- had changed was one anybody holding the class list could work out, and that a lost SIM left an
-- account whoever picked it up could reset. The sign-in is now the code alone, and what keeps codes
-- rare is the session: one per app, long-lived, so a device asks once.
--
-- "pinHash" held the argon2 hash and "pinIsDefault" whether it was still the one an import issued.
-- Nothing reads either. Both are dropped, and the hashes with them: that is the point, not a loss to
-- guard against. There is nothing to move — no column takes their place — and no index, constraint
-- or trigger named either one.

ALTER TABLE "Student" DROP COLUMN "pinHash",
DROP COLUMN "pinIsDefault";
