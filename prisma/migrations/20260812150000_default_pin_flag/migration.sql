-- Imported students are given a starting PIN (the first four digits of their
-- mobile number) so a roster can sign in the day it is uploaded. That PIN is
-- guessable by anyone who knows the number, so it is marked rather than
-- forgotten: "has signed in" now means the student set a PIN of their own, and
-- a default one can be prompted for replacement.
--
-- Existing rows are correct at false: every PIN in the table so far was chosen
-- by the student through the OTP flow.
ALTER TABLE "Student" ADD COLUMN "pinIsDefault" BOOLEAN NOT NULL DEFAULT false;
