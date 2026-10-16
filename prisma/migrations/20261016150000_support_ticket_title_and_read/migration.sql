-- A ticket's optional title, and the two stamps behind the 24-hour unread reminder email.
ALTER TABLE "SupportTicket" ADD COLUMN "title" TEXT,
ADD COLUMN "studentReadAt" TIMESTAMPTZ(3),
ADD COLUMN "unreadEmailedAt" TIMESTAMPTZ(3);
