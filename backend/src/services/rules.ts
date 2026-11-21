import { addDays, addMonths, addYears, differenceInCalendarDays } from "date-fns";
import type { DurationUnit } from "@prisma/client";

export function subscriptionEndDate(start: Date, duration: number, unit: DurationUnit) {
  const exclusiveEnd = unit === "DAY" ? addDays(start, duration) : unit === "MONTH" ? addMonths(start, duration) : addYears(start, duration);
  return addDays(exclusiveEnd, -1);
}
export function periodsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) { return aStart <= bEnd && bStart <= aEnd; }
export function shiftsOverlap(a: { startMinutes: number; endMinutes: number; fullDay?: boolean; crossesMidnight?: boolean }, b: { startMinutes: number; endMinutes: number; fullDay?: boolean; crossesMidnight?: boolean }) {
  if (a.fullDay || b.fullDay) return true;
  const intervals = (s: typeof a) => s.crossesMidnight || s.endMinutes <= s.startMinutes ? [[s.startMinutes, 1440], [0, s.endMinutes]] : [[s.startMinutes, s.endMinutes]];
  return intervals(a).some(x => intervals(b).some(y => x[0]! < y[1]! && y[0]! < x[1]!));
}
export function fineForReturn(due: Date, returned: Date, dailyRatePaise: bigint) {
  return BigInt(Math.max(0, differenceInCalendarDays(returned, due))) * dailyRatePaise;
}
