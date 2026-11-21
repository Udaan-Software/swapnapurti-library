ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SEAT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SEAT_EXPIRED';

ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
