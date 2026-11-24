import { describe, expect, it } from "vitest";
import { dateInTimeZone, fineForReturn, periodsCoverRange, periodsOverlap, shiftTimingIssue, shiftsOverlap, subscriptionEndDate, timeZoneBoundaries } from "../src/services/rules.js";

describe("subscription date policy", () => {
  it("uses inclusive end dates", () => expect(subscriptionEndDate(new Date("2026-01-10T00:00:00Z"), 1, "MONTH").toISOString().slice(0, 10)).toBe("2026-02-09"));
});
describe("allocation conflicts", () => {
  it("detects inclusive date overlap", () => expect(periodsOverlap(new Date("2026-01-01"), new Date("2026-01-10"), new Date("2026-01-10"), new Date("2026-01-12"))).toBe(true));
  it("treats full-day as conflicting with a shift", () => expect(shiftsOverlap({ startMinutes: 360, endMinutes: 1380, fullDay: true }, { startMinutes: 720, endMinutes: 1080 })).toBe(true));
  it("handles overnight shifts", () => expect(shiftsOverlap({ startMinutes: 1320, endMinutes: 120, crossesMidnight: true }, { startMinutes: 60, endMinutes: 180 })).toBe(true));
  it("accepts continuous access split across renewals", () => expect(periodsCoverRange([{ startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31") }, { startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28") }], new Date("2026-01-15"), new Date("2026-02-15"))).toBe(true));
  it("rejects a gap between memberships", () => expect(periodsCoverRange([{ startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31") }, { startDate: new Date("2026-02-02"), endDate: new Date("2026-02-28") }], new Date("2026-01-15"), new Date("2026-02-15"))).toBe(false));
  it("validates overnight and full-day shift flags", () => { expect(shiftTimingIssue({ startMinutes: 1320, endMinutes: 120 })).toBeTruthy(); expect(shiftTimingIssue({ startMinutes: 1320, endMinutes: 120, crossesMidnight: true })).toBeUndefined(); expect(shiftTimingIssue({ startMinutes: 0, endMinutes: 0, fullDay: true })).toBeUndefined(); });
  it("uses the library timezone for the business date", () => expect(dateInTimeZone(new Date("2026-01-01T20:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-01-02T00:00:00.000Z"));
  it("uses India midnight for timestamp reporting boundaries", () => { const bounds = timeZoneBoundaries(new Date("2026-01-02T10:00:00Z"), "Asia/Kolkata"); expect(bounds.dayStart.toISOString()).toBe("2026-01-01T18:30:00.000Z"); expect(bounds.nextDayStart.toISOString()).toBe("2026-01-02T18:30:00.000Z"); });
});
describe("fine calculations", () => {
  it("uses integer paise and never charges early returns", () => { expect(fineForReturn(new Date("2026-01-10"), new Date("2026-01-13"), 500n)).toBe(1500n); expect(fineForReturn(new Date("2026-01-10"), new Date("2026-01-09"), 500n)).toBe(0n); });
});
