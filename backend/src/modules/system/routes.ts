import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, ok, pageParams } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { syncSeatAllocationNotifications } from "../../services/reminders.js";

export const dashboardRouter = Router();
export const settingsRouter = Router();
export const notificationsRouter = Router();
export const auditRouter = Router();
dashboardRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const now = new Date(),
      monthStart = new Date(now.getFullYear(), now.getMonth(), 1),
      dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      soon = new Date(now.getTime() + 7 * 86400000);
    const [
      members,
      activeMembers,
      expired,
      newMembers,
      seats,
      availableSeats,
      inside,
      titles,
      copies,
      issued,
      overdue,
      todayPayments,
      monthPayments,
      todayRefunds,
      monthRefunds,
      unpaidFines,
      expiring,
      overdueItems,
      recentPayments,
      recentRefunds,
    ] = await prisma.$transaction([
      prisma.member.count(),
      prisma.member.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({
        where: {
          OR: [
            { status: "EXPIRED" },
            { endDate: { lt: now }, status: "ACTIVE" },
          ],
        },
      }),
      prisma.member.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.seat.count({ where: { active: true } }),
      prisma.seat.count({ where: { active: true, status: "AVAILABLE" } }),
      prisma.attendance.count({ where: { status: "OPEN" } }),
      prisma.book.count({ where: { archived: false } }),
      prisma.bookCopy.count({ where: { status: { not: "ARCHIVED" } } }),
      prisma.bookLoan.count({ where: { status: "ACTIVE" } }),
      prisma.bookLoan.count({
        where: { status: { in: ["ACTIVE", "OVERDUE"] }, dueDate: { lt: now } },
      }),
      prisma.payment.aggregate({
        where: { paidAt: { gte: dayStart } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.refund.aggregate({
        where: { refundedAt: { gte: dayStart } },
        _sum: { amount: true },
      }),
      prisma.refund.aggregate({
        where: { refundedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.fine.aggregate({
        where: { status: { in: ["UNPAID", "PARTIAL"] } },
        _sum: { amount: true, paidAmount: true },
      }),
      prisma.subscription.findMany({
        where: { endDate: { gte: now, lte: soon }, status: "ACTIVE" },
        include: { member: true, plan: true },
        orderBy: { endDate: "asc" },
        take: 8,
      }),
      prisma.bookLoan.findMany({
        where: { dueDate: { lt: now }, status: { in: ["ACTIVE", "OVERDUE"] } },
        include: { member: true, copy: { include: { book: true } } },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
      prisma.payment.findMany({
        where: {
          paidAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
        },
        select: { amount: true, paidAt: true },
      }),
      prisma.refund.findMany({
        where: {
          refundedAt: {
            gte: new Date(now.getFullYear(), now.getMonth() - 5, 1),
          },
        },
        select: { amount: true, refundedAt: true },
      }),
    ]);
    const revenue = new Map<string, number>();
    for (const p of recentPayments) {
      const key = p.paidAt.toISOString().slice(0, 7);
      revenue.set(key, (revenue.get(key) ?? 0) + Number(p.amount));
    }
    for (const refund of recentRefunds) {
      const key = refund.refundedAt.toISOString().slice(0, 7);
      revenue.set(key, (revenue.get(key) ?? 0) - Number(refund.amount));
    }
    ok(res, {
      stats: {
        members,
        activeMembers,
        expiredMemberships: expired,
        newMembers,
        seats,
        availableSeats,
        allocatedSeats: seats - availableSeats,
        inside,
        titles,
        copies,
        issued,
        overdue,
        todayCollections:
          Number(todayPayments._sum.amount ?? 0) -
          Number(todayRefunds._sum.amount ?? 0),
        monthlyCollections:
          Number(monthPayments._sum.amount ?? 0) -
          Number(monthRefunds._sum.amount ?? 0),
        monthlyRefunds: Number(monthRefunds._sum.amount ?? 0),
        unpaidFines:
          Number(unpaidFines._sum.amount ?? 0) -
          Number(unpaidFines._sum.paidAmount ?? 0),
      },
      charts: {
        revenue: [...revenue].map(([month, amount]) => ({ month, amount })),
      },
      alerts: { expiring, overdue: overdueItems },
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
