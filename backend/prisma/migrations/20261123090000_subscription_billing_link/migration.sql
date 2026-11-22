-- Link each membership subscription to its charge so access and accounting stay consistent.
ALTER TABLE "Invoice" ADD COLUMN "subscriptionId" UUID;

CREATE UNIQUE INDEX "Invoice_subscriptionId_key" ON "Invoice"("subscriptionId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill missing membership invoices without changing historical payments or receipts.
INSERT INTO "Invoice" ("id", "invoiceNo", "memberId", "subscriptionId", "status", "total", "paid", "dueDate", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'SWP-INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
       s."memberId", s."id", 'ISSUED'::"InvoiceStatus", s."finalFee", 0, s."startDate", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Subscription" s
WHERE NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."subscriptionId" = s."id");

INSERT INTO "InvoiceItem" ("id", "invoiceId", "type", "description", "quantity", "unitAmount", "total")
SELECT gen_random_uuid(), i."id", 'SUBSCRIPTION'::"ChargeType", 'Membership fee — ' || p."name", 1, s."finalFee", s."finalFee"
FROM "Invoice" i
JOIN "Subscription" s ON s."id" = i."subscriptionId"
JOIN "MembershipPlan" p ON p."id" = s."planId"
WHERE NOT EXISTS (SELECT 1 FROM "InvoiceItem" ii WHERE ii."invoiceId" = i."id");

-- The active plan determines the member's current access classification.
WITH current_plan AS (
  SELECT DISTINCT ON (s."memberId") s."memberId", mp."studyAccess", mp."bookAccess"
  FROM "Subscription" s
  JOIN "MembershipPlan" mp ON mp."id" = s."planId"
  WHERE s."status" = 'ACTIVE'
  ORDER BY s."memberId", s."startDate" DESC, s."createdAt" DESC
)
UPDATE "Member" m
SET "type" = CASE WHEN p."studyAccess" AND p."bookAccess" THEN 'BOTH'::"MemberType"
                  WHEN p."studyAccess" THEN 'STUDY'::"MemberType"
                  ELSE 'BOOK'::"MemberType" END,
    "updatedAt" = CURRENT_TIMESTAMP
FROM current_plan p
WHERE p."memberId" = m."id";
