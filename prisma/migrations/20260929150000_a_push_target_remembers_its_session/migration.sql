-- A browser subscription and a phone registration remember the sign-in that made them.
--
-- A push used to reach every endpoint a student had ever registered, and only the mobile account
-- screen ever dropped one. On a shared lab machine the next student therefore received the last
-- one's pushes after sign-out, a replaced session, a revoke or a PIN reset. Delivery now sends only
-- to a target whose Redis session still exists and deletes the rest, so every way a session ends
-- stops its pushes without the client's help.
--
-- Nullable, and nothing moves: a row from before this has no session to check and keeps receiving
-- until its device registers again, which records the session it registered from.

ALTER TABLE "PushSubscription" ADD COLUMN "sessionId" UUID;
ALTER TABLE "PushDevice" ADD COLUMN "sessionId" UUID;
