-- When a notification was read. A list opened before that instant still shows the row under
-- Unread, so paging forward through Unread does not skip the rows the reader has just marked.
-- Rows already read keep a null: they were read before any list open now, which is all it is read for.
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMPTZ(3);
