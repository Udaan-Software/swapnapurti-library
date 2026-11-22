import { addDays, addMonths, addYears, differenceInCalendarDays } from "date-fns";
import type { DurationUnit } from "@prisma/client";

export function subscriptionEndDate(start: Date, duration: number, unit: DurationUnit) {
  const exclusiveEnd = unit === "DAY" ? addDays(start, duration) : unit === "MONTH" ? addMonths(start, duration) : addYears(start, duration);
  return addDays(exclusiveEnd, -1);
}
export function periodsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) { return aStart <= bEnd && bStart <= aEnd; }
export function periodsCoverRange(periods: { startDate: Date; endDate: Date }[], start: Date, end: Date) {
  let coveredUntil: Date | undefined;
  for (const period of [...periods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())) {
    const nextRequired = coveredUntil ? addDays(coveredUntil, 1) : start;
    if (period.endDate < start || period.startDate > end) continue;
    if (period.startDate > nextRequired) return false;
    if (!coveredUntil || period.endDate > coveredUntil) coveredUntil = period.endDate;
    if (coveredUntil >= end) return true;
  }
  return false;
}
export function shiftsOverlap(a: { startMinutes: number; endMinutes: number; fullDay?: boolean; crossesMidnight?: boolean }, b: { startMinutes: number; endMinutes: number; fullDay?: boolean; crossesMidnight?: boolean }) {
  if (a.fullDay || b.fullDay) return true;
  const intervals = (s: typeof a) => s.crossesMidnight || s.endMinutes <= s.startMinutes ? [[s.startMinutes, 1440], [0, s.endMinutes]] : [[s.startMinutes, s.endMinutes]];
  return intervals(a).some(x => intervals(b).some(y => x[0]! < y[1]! && y[0]! < x[1]!));
}
export function shiftTimingIssue(shift: { startMinutes: number; endMinutes: number; fullDay?: boolean; crossesMidnight?: boolean }) {
  if (shift.fullDay && shift.crossesMidnight) return "A full-day shift must not also be marked as crossing midnight.";
  if (shift.fullDay) return undefined;
  if (shift.startMinutes === shift.endMinutes) return "Use full-day access when the start and end times are the same.";
  if (shift.crossesMidnight && shift.endMinutes > shift.startMinutes) return "A shift marked as crossing midnight must end earlier than it starts.";
  if (!shift.crossesMidnight && shift.endMinutes < shift.startMinutes) return "A shift ending after midnight must be marked as crossing midnight.";
  return undefined;
}
export function dateInTimeZone(now = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
}
export function fineForReturn(due: Date, returned: Date, dailyRatePaise: bigint) {
  return BigInt(Math.max(0, differenceInCalendarDays(returned, due))) * dailyRatePaise;
}
