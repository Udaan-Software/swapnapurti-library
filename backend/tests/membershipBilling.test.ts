import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { membershipQuote } from "../src/services/membershipBilling.js";

const monthlyPlan = { price: new Prisma.Decimal(1200), duration: 1, durationUnit: "MONTH" as const };

describe("membership pricing", () => {
  it("uses the plan price and end date by default", () => {
    const quote = membershipQuote(monthlyPlan, new Date("2026-11-24T00:00:00Z"));
    expect(quote.defaultEndDate.toISOString().slice(0, 10)).toBe("2026-12-23");
    expect(quote.assignedDays).toBe(30);
    expect(quote.finalFee.toFixed(2)).toBe("1200.00");
  });

  it("prorates an extended period by inclusive assigned days", () => {
    const quote = membershipQuote(monthlyPlan, new Date("2026-11-24T00:00:00Z"), new Date("2027-01-22T00:00:00Z"), 100);
    expect(quote.assignedDays).toBe(60);
    expect(quote.originalFee.toFixed(2)).toBe("2400.00");
    expect(quote.finalFee.toFixed(2)).toBe("2300.00");
  });
});
