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
  return new Date(`${dateKeyInTimeZone(now, timeZone)}T00:00:00.000Z`);
}
export function dateKeyInTimeZone(now = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function timeZoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value);
  const representedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
function localMidnightInstant(calendarDate: Date, timeZone: string) {
  const wallTime = Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth(), calendarDate.getUTCDate());
  let instant = new Date(wallTime);
  instant = new Date(wallTime - timeZoneOffsetMs(instant, timeZone));
  return new Date(wallTime - timeZoneOffsetMs(instant, timeZone));
}
export function timeZoneBoundaries(now = new Date(), timeZone = "Asia/Kolkata") {
  const localDate = dateInTimeZone(now, timeZone);
  const month = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1));
  const nextDay = addDays(localDate, 1), nextMonth = addMonths(month, 1), sixMonthStart = addMonths(month, -5);
  return {
    dayStart: localMidnightInstant(localDate, timeZone),
    nextDayStart: localMidnightInstant(nextDay, timeZone),
    monthStart: localMidnightInstant(month, timeZone),
    nextMonthStart: localMidnightInstant(nextMonth, timeZone),
    sixMonthStart: localMidnightInstant(sixMonthStart, timeZone),
    localDate,
  };
}
export function fineForReturn(due: Date, returned: Date, dailyRatePaise: bigint) {
  return BigInt(Math.max(0, differenceInCalendarDays(returned, due))) * dailyRatePaise;
}
