import { AllocationStatus, NotificationType, SeatStatus } from "@prisma/client";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { dateInTimeZone } from "./rules.js";

function reminderDays(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 3;
  const days = Number((value as Record<string, unknown>).seatExpiryDays);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? days : 3;
}

export async function syncSeatAllocationNotifications(now = new Date()) {
  const today = dateInTimeZone(now, env.LIBRARY_TIMEZONE);
  const starting = await prisma.seatAllocation.findMany({ where: { status: AllocationStatus.UPCOMING, startDate: { lte: today }, endDate: { gte: today } }, select: { id: true, seatId: true } });
  if (starting.length) await prisma.$transaction(async tx => {
    await tx.seatAllocation.updateMany({ where: { id: { in: starting.map(item => item.id) }, status: AllocationStatus.UPCOMING }, data: { status: AllocationStatus.ACTIVE } });
    await tx.seat.updateMany({ where: { id: { in: [...new Set(starting.map(item => item.seatId))] }, active: true, status: SeatStatus.AVAILABLE }, data: { status: SeatStatus.ALLOCATED } });
  });
  const settings = await prisma.appSetting.findUnique({ where: { key: "notifications" } });
  const days = reminderDays(settings?.value);
  const reminderEnd = addDays(today, days);
  const expiring = await prisma.seatAllocation.findMany({
    where: { status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, endDate: { gte: today, lte: reminderEnd } },
    include: { member: true, seat: { include: { room: true } }, shift: true },
  });
  for (const allocation of expiring) {
    const remaining = differenceInCalendarDays(allocation.endDate, today);
    const timing = remaining === 0 ? "ends today" : `ends in ${remaining} day${remaining === 1 ? "" : "s"}`;
    await prisma.notification.createMany({
      skipDuplicates: true,
      data: {
        dedupeKey: `seat-expiring:${allocation.id}:${format(allocation.endDate, "yyyy-MM-dd")}`,
        memberId: allocation.memberId,
        type: NotificationType.SEAT_EXPIRING,
        title: `Seat allocation ${timing}`,
        message: `${allocation.member.publicId} · ${allocation.member.fullName} — ${allocation.seat.room.name}, Seat ${allocation.seat.number}, ${allocation.shift.name}. Allocation ends ${format(allocation.endDate, "dd MMM yyyy")}. Review renewal or release arrangements.`,
        scheduledAt: now,
        sentAt: now,
      },
    });
  }

  const expired = await prisma.seatAllocation.findMany({
    where: { status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, endDate: { lt: today } },
    include: { member: true, seat: { include: { room: true } }, shift: true },
  });
  for (const allocation of expired) {
    await prisma.$transaction(async tx => {
      const changed = await tx.seatAllocation.updateMany({ where: { id: allocation.id, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] } }, data: { status: AllocationStatus.EXPIRED } });
      if (!changed.count) return;
      const current = await tx.seatAllocation.count({ where: { seatId: allocation.seatId, status: AllocationStatus.ACTIVE, startDate: { lte: today }, endDate: { gte: today } } });
      if (!current) await tx.seat.updateMany({ where: { id: allocation.seatId, status: SeatStatus.ALLOCATED }, data: { status: SeatStatus.AVAILABLE } });
      await tx.notification.upsert({
        where: { dedupeKey: `seat-expired:${allocation.id}:${format(allocation.endDate, "yyyy-MM-dd")}` },
        update: {},
        create: {
          dedupeKey: `seat-expired:${allocation.id}:${format(allocation.endDate, "yyyy-MM-dd")}`,
          memberId: allocation.memberId,
          type: NotificationType.SEAT_EXPIRED,
          title: "Seat allocation expired",
          message: `${allocation.member.publicId} · ${allocation.member.fullName} — ${allocation.seat.room.name}, Seat ${allocation.seat.number}, ${allocation.shift.name}. Allocation ended ${format(allocation.endDate, "dd MMM yyyy")}. The seat is available again unless another current allocation exists.`,
          scheduledAt: now,
          sentAt: now,
        },
      });
    });
  }
  return { activated: starting.length, expiring: expiring.length, expired: expired.length };
}

export function startReminderJobs() {
  const run = () => { void syncSeatAllocationNotifications().catch(error => console.error("Seat reminder job failed", error)); };
  run();
  const timer = setInterval(run, 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
