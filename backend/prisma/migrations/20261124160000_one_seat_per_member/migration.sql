-- A member can hold only one active/upcoming seat for any overlapping date.
-- Seat reassignment updates the existing allocation instead of creating a
-- second allocation, preserving history while releasing the previous seat.
ALTER TABLE "SeatAllocation" ADD CONSTRAINT "SeatAllocation_one_seat_per_member"
  EXCLUDE USING gist (
    "memberId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("status" IN ('UPCOMING', 'ACTIVE'));
