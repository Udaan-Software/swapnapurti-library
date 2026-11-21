import { DurationUnit, PlanType, SubscriptionStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok, pageParams } from "../../utils/http.js";
import { subscriptionEndDate } from "../../services/rules.js";
import { audit } from "../../services/audit.js";

export const plansRouter = Router();
export const subscriptionsRouter = Router();
const planInput = z.object({ name: z.string().min(2), type: z.nativeEnum(PlanType), price: z.coerce.number().nonnegative(), duration: z.coerce.number().int().positive(), durationUnit: z.nativeEnum(DurationUnit), studyAccess: z.boolean(), bookAccess: z.boolean(), maxBooks: z.coerce.number().int().nonnegative().default(0), loanDays: z.coerce.number().int().nonnegative().default(0), renewalLimit: z.coerce.number().int().nonnegative().default(0), description: z.string().optional().nullable(), active: z.boolean().default(true) });
plansRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.membershipPlan.findMany({ orderBy: { name: "asc" }, include: { allowedShifts: { include: { shift: true } } } }))));
plansRouter.post("/", asyncHandler(async (req, res) => { const data = planInput.parse(req.body); const plan = await prisma.membershipPlan.create({ data: { ...data, price: data.price.toFixed(2) } }); await audit(req, "PLAN_CREATED", "MembershipPlan", plan.id, data); ok(res.status(201), plan); }));
plansRouter.patch("/:id", asyncHandler(async (req, res) => { const data = planInput.partial().parse(req.body); const plan = await prisma.membershipPlan.update({ where: { id: String(req.params.id) }, data: { ...data, price: data.price?.toFixed(2) } }); await audit(req, "PLAN_UPDATED", "MembershipPlan", plan.id); ok(res, plan); }));

const subscriptionInput = z.object({ memberId: z.string().uuid(), planId: z.string().uuid(), startDate: z.string().date(), discount: z.coerce.number().min(0).default(0), renewalReference: z.string().uuid().optional() });
subscriptionsRouter.get("/", asyncHandler(async (req, res) => { const { page, pageSize, skip } = pageParams(req); const where = req.query.status ? { status: req.query.status as SubscriptionStatus } : {}; const [items, total] = await prisma.$transaction([prisma.subscription.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" }, include: { member: true, plan: true } }), prisma.subscription.count({ where })]); ok(res, items, { page, pageSize, total }); }));
subscriptionsRouter.post("/", asyncHandler(async (req, res) => {
  const body = subscriptionInput.parse(req.body); const [member, plan] = await Promise.all([prisma.member.findUnique({ where: { id: body.memberId } }), prisma.membershipPlan.findUnique({ where: { id: body.planId }, include: { allowedShifts: true } })]);
  if (!member || !plan || !plan.active) throw new AppError(400, "Member or active plan was not found."); const start = new Date(body.startDate); const final = Math.max(0, Number(plan.price) - body.discount);
  const subscription = await prisma.subscription.create({ data: { memberId: member.id, planId: plan.id, startDate: start, endDate: subscriptionEndDate(start, plan.duration, plan.durationUnit), originalFee: plan.price, discount: body.discount.toFixed(2), finalFee: final.toFixed(2), renewalReference: body.renewalReference, planSnapshot: { name: plan.name, type: plan.type, price: plan.price.toString(), duration: plan.duration, durationUnit: plan.durationUnit, studyAccess: plan.studyAccess, bookAccess: plan.bookAccess, maxBooks: plan.maxBooks, loanDays: plan.loanDays, renewalLimit: plan.renewalLimit, shiftIds: plan.allowedShifts.map(s => s.shiftId) } } });
  await audit(req, body.renewalReference ? "SUBSCRIPTION_RENEWED" : "SUBSCRIPTION_CREATED", "Subscription", subscription.id, { memberId: member.id, planId: plan.id }); ok(res.status(201), subscription);
}));
