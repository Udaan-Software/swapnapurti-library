import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, ok, pageParams } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { syncSeatAllocationNotifications } from "../../services/reminders.js";
import { env } from "../../config/env.js";
import { dateKeyInTimeZone, shiftsOverlap, timeZoneBoundaries } from "../../services/rules.js";

export const dashboardRouter = Router();
export const settingsRouter = Router();
export const notificationsRouter = Router();
export const auditRouter = Router();
dashboardRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const { dayStart, nextDayStart, monthStart, nextMonthStart, sixMonthStart, localDate: today } = timeZoneBoundaries(now, env.LIBRARY_TIMEZONE);
    const soon = new Date(today.getTime() + 7 * 86400000);
    const seatSoon = new Date(today.getTime() + 3 * 86400000);
    const result = await prisma.$transaction(async tx => {
      const [room, permanent] = await Promise.all([
        tx.studyRoom.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }),
        tx.shift.findFirst({ where: { active: true }, orderBy: [{ fullDay: "desc" }, { createdAt: "asc" }] }),
      ]);
      const operationalSeats = room ? await tx.seat.findMany({
        where: { roomId: room.id, active: true, status: { notIn: ["MAINTENANCE", "DISABLED"] } },
        include: { allocations: { where: { status: { in: ["ACTIVE", "UPCOMING"] }, startDate: { lte: today }, endDate: { gte: today } }, include: { shift: true } } },
      }) : [];
      const [
        members,
        activeMembers,
        expiredMemberships,
        newMembers,
        inside,
        todayPayments,
        monthPayments,
        todayRefunds,
        monthRefunds,
        pendingInvoices,
        expiring,
        seatExpiring,
        recentPayments,
        recentRefunds,
      ] = await Promise.all([
        tx.member.count(),
        tx.member.count({ where: { status: "ACTIVE" } }),
        tx.member.count({ where: { status: "ACTIVE", subscriptions: { some: { status: { in: ["ACTIVE", "EXPIRED"] }, endDate: { lt: today } }, none: { status: "ACTIVE", endDate: { gte: today } } } } }),
        tx.member.count({ where: { registrationDate: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), lte: today } } }),
        tx.attendance.count({ where: { status: "OPEN" } }),
        tx.payment.aggregate({ where: { paidAt: { gte: dayStart, lt: nextDayStart } }, _sum: { amount: true } }),
        tx.payment.aggregate({ where: { paidAt: { gte: monthStart, lt: nextMonthStart } }, _sum: { amount: true } }),
        tx.refund.aggregate({ where: { refundedAt: { gte: dayStart, lt: nextDayStart } }, _sum: { amount: true } }),
        tx.refund.aggregate({ where: { refundedAt: { gte: monthStart, lt: nextMonthStart } }, _sum: { amount: true } }),
        tx.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIAL"] } }, _sum: { total: true, paid: true } }),
        tx.subscription.findMany({ where: { endDate: { gte: today, lte: soon }, status: "ACTIVE" }, include: { member: true, plan: true }, orderBy: { endDate: "asc" }, take: 8 }),
        room ? tx.seatAllocation.findMany({ where: { seat: { roomId: room.id }, status: { in: ["ACTIVE", "UPCOMING"] }, endDate: { gte: today, lte: seatSoon } }, include: { member: true, seat: true }, orderBy: { endDate: "asc" }, take: 8 }) : Promise.resolve([]),
        tx.payment.findMany({ where: { paidAt: { gte: sixMonthStart, lt: nextMonthStart } }, select: { amount: true, paidAt: true } }),
        tx.refund.findMany({ where: { refundedAt: { gte: sixMonthStart, lt: nextMonthStart } }, select: { amount: true, refundedAt: true } }),
      ]);
      const availableSeats = permanent ? operationalSeats.filter(seat => !seat.allocations.some(allocation => shiftsOverlap(permanent, allocation.shift))).length : 0;
      return { members, activeMembers, expiredMemberships, newMembers, inside, todayPayments, monthPayments, todayRefunds, monthRefunds, pendingInvoices, expiring, seatExpiring, recentPayments, recentRefunds, seats: operationalSeats.length, availableSeats };
    });
    const revenue = new Map<string, { month: string; amount: number }>();
    for (let offset = -5; offset <= 0; offset++) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
      const key = date.toISOString().slice(0, 7);
      revenue.set(key, { month: new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date), amount: 0 });
    }
    for (const payment of result.recentPayments) {
      const key = dateKeyInTimeZone(payment.paidAt, env.LIBRARY_TIMEZONE).slice(0, 7);
      const bucket = revenue.get(key);
      if (bucket) bucket.amount += Number(payment.amount);
    }
    for (const refund of result.recentRefunds) {
      const key = dateKeyInTimeZone(refund.refundedAt, env.LIBRARY_TIMEZONE).slice(0, 7);
      const bucket = revenue.get(key);
      if (bucket) bucket.amount -= Number(refund.amount);
    }
    ok(res, {
      stats: {
        members: result.members,
        activeMembers: result.activeMembers,
        expiredMemberships: result.expiredMemberships,
        newMembers: result.newMembers,
        seats: result.seats,
        availableSeats: result.availableSeats,
        allocatedSeats: result.seats - result.availableSeats,
        inside: result.inside,
        pendingAmount: Number(result.pendingInvoices._sum.total ?? 0) - Number(result.pendingInvoices._sum.paid ?? 0),
        todayCollections: Number(result.todayPayments._sum.amount ?? 0) - Number(result.todayRefunds._sum.amount ?? 0),
        monthlyCollections: Number(result.monthPayments._sum.amount ?? 0) - Number(result.monthRefunds._sum.amount ?? 0),
        monthlyRefunds: Number(result.monthRefunds._sum.amount ?? 0),
      },
      charts: { revenue: [...revenue.values()] },
      alerts: { expiring: result.expiring, seatExpiring: result.seatExpiring },
    });
  }),
);
settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.appSetting.findMany();
    ok(res, Object.fromEntries(rows.map((x) => [x.key, x.value])));
  }),
);
settingsRouter.put(
  "/:key",
  asyncHandler(async (req, res) => {
    const value = z
      .record(z.string(), z.unknown())
      .parse(req.body) as Prisma.InputJsonObject;
    const key = String(req.params.key);
    const item = await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    await audit(req, "SETTINGS_UPDATED", "AppSetting", item.key, value);
    ok(res, item);
  }),
);
notificationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    await syncSeatAllocationNotifications();
    ok(
      res,
      await prisma.notification.findMany({
        include: { member: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  }),
);
notificationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        title: z.string().min(2).max(120),
        message: z.string().min(2).max(1000),
        memberId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const item = await prisma.notification.create({
      data: { ...body, type: "ANNOUNCEMENT" },
    });
    await audit(req, "NOTIFICATION_CREATED", "Notification", item.id);
    ok(res.status(201), item);
  }),
);
notificationsRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) =>
    ok(
      res,
      await prisma.notification.update({
        where: { id: String(req.params.id) },
        data: { status: "READ" },
      }),
    ),
  ),
);
auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req);
    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        skip,
        take: pageSize,
        include: { admin: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count(),
    ]);
    ok(res, items, { page, pageSize, total });
  }),
);
