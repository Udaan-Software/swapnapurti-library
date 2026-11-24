import { AllocationStatus, InvoiceStatus, NotificationType, SeatStatus, SubscriptionStatus } from "@prisma/client";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { dateInTimeZone } from "./rules.js";

export function reminderSettings(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const valid = (key: string, fallback: number) => { const days = Number(source[key]); return Number.isInteger(days) && days >= 1 && days <= 30 ? days : fallback; };
  return { seatExpiryDays: valid("seatExpiryDays", 3), membershipExpiryDays: valid("membershipExpiryDays", 7), paymentDueDays: valid("paymentDueDays", 1) };
}

export async function syncSeatAllocationNotifications(now = new Date()) {
  const today = dateInTimeZone(now, env.LIBRARY_TIMEZONE);
  const starting = await prisma.seatAllocation.findMany({ where: { status: AllocationStatus.UPCOMING, startDate: { lte: today }, endDate: { gte: today } }, select: { id: true, seatId: true } });
  if (starting.length) await prisma.$transaction(async tx => {
    await tx.seatAllocation.updateMany({ where: { id: { in: starting.map(item => item.id) }, status: AllocationStatus.UPCOMING }, data: { status: AllocationStatus.ACTIVE } });
    await tx.seat.updateMany({ where: { id: { in: [...new Set(starting.map(item => item.seatId))] }, active: true, status: SeatStatus.AVAILABLE }, data: { status: SeatStatus.ALLOCATED } });
  });
  const settings = await prisma.appSetting.findUnique({ where: { key: "notifications" } });
  const config = reminderSettings(settings?.value);
  const reminderEnd = addDays(today, config.seatExpiryDays);
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
  const membershipReminderEnd = addDays(today, config.membershipExpiryDays);
  const expiringMemberships = await prisma.subscription.findMany({
    where: { status: SubscriptionStatus.ACTIVE, endDate: { gte: today, lte: membershipReminderEnd } },
    include: { member: true, plan: true },
    orderBy: { endDate: "asc" },
  });
  let membershipExpiring = 0;
  for (const subscription of expiringMemberships) {
    const renewed = await prisma.subscription.count({ where: { id: { not: subscription.id }, memberId: subscription.memberId, status: SubscriptionStatus.ACTIVE, startDate: { lte: addDays(subscription.endDate, 1) }, endDate: { gt: subscription.endDate } } });
    if (renewed) continue;
    const remaining = differenceInCalendarDays(subscription.endDate, today);
    const timing = remaining === 0 ? "ends today" : `ends in ${remaining} day${remaining === 1 ? "" : "s"}`;
    const created = await prisma.notification.createMany({ skipDuplicates: true, data: { dedupeKey: `membership-expiring:${subscription.id}:${format(subscription.endDate, "yyyy-MM-dd")}`, memberId: subscription.memberId, type: NotificationType.MEMBERSHIP_EXPIRING, title: `Membership ${timing}`, message: `${subscription.member.publicId} · ${subscription.member.fullName} — ${subscription.plan.name} ends ${format(subscription.endDate, "dd MMM yyyy")}. Review renewal and payment arrangements.`, scheduledAt: now, sentAt: now } });
    membershipExpiring += created.count;
  }

  const expiredMemberships = await prisma.subscription.findMany({ where: { status: SubscriptionStatus.ACTIVE, endDate: { lt: today } }, include: { member: true, plan: true } });
  let membershipExpired = 0;
  for (const subscription of expiredMemberships) {
    await prisma.$transaction(async tx => {
      const changed = await tx.subscription.updateMany({ where: { id: subscription.id, status: SubscriptionStatus.ACTIVE }, data: { status: SubscriptionStatus.EXPIRED } });
      if (!changed.count) return;
      const replacement = await tx.subscription.count({ where: { id: { not: subscription.id }, memberId: subscription.memberId, status: SubscriptionStatus.ACTIVE, startDate: { lte: today }, endDate: { gte: today } } });
      if (replacement) return;
      await tx.notification.upsert({ where: { dedupeKey: `membership-expired:${subscription.id}:${format(subscription.endDate, "yyyy-MM-dd")}` }, update: {}, create: { dedupeKey: `membership-expired:${subscription.id}:${format(subscription.endDate, "yyyy-MM-dd")}`, memberId: subscription.memberId, type: NotificationType.MEMBERSHIP_EXPIRED, title: "Membership expired", message: `${subscription.member.publicId} · ${subscription.member.fullName} — ${subscription.plan.name} ended ${format(subscription.endDate, "dd MMM yyyy")}. Renew the membership to restore access.`, scheduledAt: now, sentAt: now } });
      membershipExpired += 1;
    });
  }

  const paymentDueEnd = addDays(today, config.paymentDueDays);
  const pendingInvoices = await prisma.invoice.findMany({ where: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIAL] }, dueDate: { not: null, lte: paymentDueEnd } }, include: { member: true } });
  let paymentPending = 0;
  for (const invoice of pendingInvoices) {
    const balance = Number(invoice.total) - Number(invoice.paid);
    if (balance <= 0 || !invoice.dueDate) continue;
    const remaining = differenceInCalendarDays(invoice.dueDate, today);
    const timing = remaining < 0 ? `overdue by ${Math.abs(remaining)} day${remaining === -1 ? "" : "s"}` : remaining === 0 ? "due today" : `due in ${remaining} day${remaining === 1 ? "" : "s"}`;
    const created = await prisma.notification.createMany({ skipDuplicates: true, data: { dedupeKey: `payment-pending:${invoice.id}:${format(invoice.dueDate, "yyyy-MM-dd")}`, memberId: invoice.memberId, type: NotificationType.PAYMENT_PENDING, title: `Payment ${timing}`, message: `${invoice.member.publicId} · ${invoice.member.fullName} — ${invoice.invoiceNo} has an outstanding balance of INR ${balance.toFixed(2)} and is ${timing}.`, scheduledAt: now, sentAt: now } });
    paymentPending += created.count;
  }
  return { activated: starting.length, seatExpiring: expiring.length, seatExpired: expired.length, membershipExpiring, membershipExpired, paymentPending };
}

export function startReminderJobs() {
  const run = () => { void syncSeatAllocationNotifications().catch(error => console.error("Scheduled reminder job failed", error)); };
  run();
  const timer = setInterval(run, 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
