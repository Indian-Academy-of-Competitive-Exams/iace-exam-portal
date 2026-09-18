-- A phone is reached by its own token, not by a browser subscription.
--
-- PushSubscription stays exactly as it is. A browser subscription carries the keys that encrypt
-- a payload for one endpoint; an FCM registration token is one opaque string Google owns and
-- rotates, and the two have no column worth sharing a table for.
--
-- Nothing moves: no student holds a device token yet, so the table starts empty and the new
-- DeliveryChannel value is unused until the first phone registers. Postgres refuses an enum
-- value used in the transaction that created it, and nothing here reads MOBILE_PUSH.
--
-- Dated after every_id_is_a_uuid deliberately: this table is created with uuid keys rather than
-- created as text and converted, so the conversion never has to know it existed.
-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- AlterEnum
ALTER TYPE "DeliveryChannel" ADD VALUE 'MOBILE_PUSH';

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_studentId_idx" ON "PushDevice"("studentId");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

