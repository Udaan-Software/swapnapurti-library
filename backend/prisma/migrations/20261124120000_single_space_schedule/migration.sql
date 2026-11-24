-- Keep the relational room/shift keys used by allocations, while configuring
-- one permanent schedule and one automatically selected study space.
INSERT INTO "Shift" ("id", "name", "startMinutes", "endMinutes", "crossesMidnight", "fullDay", "active", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Permanent', 0, 0, false, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE
SET "startMinutes" = 0,
    "endMinutes" = 0,
    "crossesMidnight" = false,
    "fullDay" = true,
    "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Shift"
SET "active" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" <> 'Permanent';

INSERT INTO "StudyRoom" ("id", "name", "description", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Main Study Space', 'Primary study seating area', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "StudyRoom" WHERE "active" = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MembershipPlan" WHERE "name" = 'Book Membership')
     AND NOT EXISTS (SELECT 1 FROM "MembershipPlan" WHERE "name" = 'Class Membership') THEN
    UPDATE "MembershipPlan" SET "name" = 'Class Membership', "maxBooks" = 0, "loanDays" = 0, "renewalLimit" = 0 WHERE "name" = 'Book Membership';
  END IF;
  IF EXISTS (SELECT 1 FROM "MembershipPlan" WHERE "name" = 'Study + Books')
     AND NOT EXISTS (SELECT 1 FROM "MembershipPlan" WHERE "name" = 'Study + Class') THEN
    UPDATE "MembershipPlan" SET "name" = 'Study + Class', "maxBooks" = 0, "loanDays" = 0, "renewalLimit" = 0 WHERE "name" = 'Study + Books';
  END IF;
END $$;
