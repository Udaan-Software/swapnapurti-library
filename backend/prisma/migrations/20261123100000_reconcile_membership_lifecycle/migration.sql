-- Close stale memberships before exposing their linked balances.
UPDATE "Subscription"
SET "status" = 'EXPIRED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ACTIVE' AND "endDate" < CURRENT_DATE;

-- Backfilled historical/cancelled memberships must not create a new amount due.
UPDATE "Invoice" i
SET "status" = 'VOID', "updatedAt" = CURRENT_TIMESTAMP
FROM "Subscription" s
WHERE i."subscriptionId" = s."id"
  AND s."status" IN ('EXPIRED', 'CANCELLED')
  AND i."paid" = 0;
