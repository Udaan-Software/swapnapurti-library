import { describe, expect, it } from "vitest";
import { fineForReturn, periodsOverlap, shiftsOverlap, subscriptionEndDate } from "../src/services/rules.js";

describe("subscription date policy", () => {
  it("uses inclusive end dates", () => expect(subscriptionEndDate(new Date("2026-01-10T00:00:00Z"), 1, "MONTH").toISOString().slice(0, 10)).toBe("2026-02-09"));
});
describe("allocation conflicts", () => {
  it("detects inclusive date overlap", () => expect(periodsOverlap(new Date("2026-01-01"), new Date("2026-01-10"), new Date("2026-01-10"), new Date("2026-01-12"))).toBe(true));
  it("treats full-day as conflicting with a shift", () => expect(shiftsOverlap({ startMinutes: 360, endMinutes: 1380, fullDay: true }, { startMinutes: 720, endMinutes: 1080 })).toBe(true));
  it("handles overnight shifts", () => expect(shiftsOverlap({ startMinutes: 1320, endMinutes: 120, crossesMidnight: true }, { startMinutes: 60, endMinutes: 180 })).toBe(true));
});
describe("fine calculations", () => {
  it("uses integer paise and never charges early returns", () => { expect(fineForReturn(new Date("2026-01-10"), new Date("2026-01-13"), 500n)).toBe(1500n); expect(fineForReturn(new Date("2026-01-10"), new Date("2026-01-09"), 500n)).toBe(0n); });
});
