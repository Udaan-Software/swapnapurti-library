import { AllocationStatus, MemberType, Prisma, RecordStatus, SeatStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok, pageParams } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { createBilledSubscription, memberTypeForPlan, membershipQuote } from "../../services/membershipBilling.js";
import { dateInTimeZone, shiftsOverlap } from "../../services/rules.js";
import { env } from "../../config/env.js";
import { permanentShift, primaryRoom } from "../../services/studyDefaults.js";

export const membersRouter = Router();
const input = z.object({ fullName: z.string().trim().min(2).max(120), mobile: z.string().regex(/^[0-9+ -]{8,16}$/), email: z.string().email().optional().or(z.literal("")), dateOfBirth: z.string().date().optional().nullable(), gender: z.string().max(30).optional().nullable(), address: z.string().max(500).optional().nullable(), emergencyContact: z.string().max(50).optional().nullable(), type: z.nativeEnum(MemberType), status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE), notes: z.string().max(2000).optional().nullable() });
const registrationInput = input.extend({ membershipPlanId: z.string().uuid().optional(), membershipStartDate: z.string().date().optional(), membershipEndDate: z.string().date().optional(), membershipDiscount: z.coerce.number().nonnegative().default(0), seatId: z.string().uuid().optional() });
const zero = new Prisma.Decimal(0);
function financialSummary(member: { payments: { amount: Prisma.Decimal; refunds: { amount: Prisma.Decimal }[] }[]; invoices: { total: Prisma.Decimal; paid: Prisma.Decimal }[]; fines: { amount: Prisma.Decimal; paidAmount: Prisma.Decimal }[] }) {
  const paidAmount = member.payments.reduce((sum, payment) => sum.add(payment.amount).sub(payment.refunds.reduce((refunds, refund) => refunds.add(refund.amount), zero)), zero);
  const pendingAmount = member.invoices.reduce((sum, invoice) => sum.add(invoice.total.sub(invoice.paid)), zero);
  const unpaidFines = member.fines.reduce((sum, fine) => sum.add(fine.amount.sub(fine.paidAmount)), zero);
  return { paidAmount: paidAmount.toFixed(2), pendingAmount: pendingAmount.toFixed(2), unpaidFines: unpaidFines.toFixed(2) };
}

membersRouter.get("/", asyncHandler(async (req, res) => {
  const { page, pageSize, skip } = pageParams(req); const search = String(req.query.search ?? "").trim();
  const where = { ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" as const } }, { publicId: { contains: search, mode: "insensitive" as const } }, { mobile: { contains: search } }] } : {}), ...(req.query.status ? { status: req.query.status as RecordStatus } : {}), ...(req.query.type ? { type: req.query.type as MemberType } : {}) };
  const [items, total] = await prisma.$transaction([prisma.member.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" }, include: { subscriptions: { where: { status: "ACTIVE" }, include: { plan: true }, orderBy: { endDate: "desc" }, take: 1 }, payments: { select: { amount: true, refunds: { select: { amount: true } } } }, invoices: { where: { status: { in: ["ISSUED", "PARTIAL"] } }, select: { total: true, paid: true } }, fines: { where: { status: { in: ["UNPAID", "PARTIAL"] } }, select: { amount: true, paidAmount: true } } } }), prisma.member.count({ where })]);
  ok(res, items.map(({ payments, invoices, fines, ...member }) => ({ ...member, financialSummary: financialSummary({ payments, invoices, fines }) })), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}));
membersRouter.post("/", asyncHandler(async (req, res) => {
  const body = registrationInput.parse(req.body);
  const today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  const startDate = body.membershipStartDate ? new Date(`${body.membershipStartDate}T00:00:00.000Z`) : today;
  if (startDate < today) throw new AppError(422, "Membership cannot start in the past.", "PAST_MEMBERSHIP");
  const member = await prisma.$transaction(async tx => {
    const plan = body.membershipPlanId ? await tx.membershipPlan.findUnique({ where: { id: body.membershipPlanId }, include: { allowedShifts: true } }) : null;
    if (body.membershipPlanId && (!plan || !plan.active)) throw new AppError(422, "Select an active membership plan.", "MEMBERSHIP_PLAN_REQUIRED");
    if (body.seatId && !plan) throw new AppError(422, "Select a membership plan before assigning a seat.", "MEMBERSHIP_PLAN_REQUIRED");
    if (body.seatId && !plan?.studyAccess) throw new AppError(422, "The selected plan does not include study seat access.", "NO_STUDY_ACCESS");
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('member_public_id_seq') AS value`;
    const publicId = `SWP-${String(rows[0]!.value).padStart(6, "0")}`;
    const { membershipPlanId: _planId, membershipStartDate: _start, membershipEndDate, membershipDiscount: _discount, seatId, ...profile } = body;
    const created = await tx.member.create({ data: { ...profile, type: plan ? memberTypeForPlan(plan) : profile.type, email: profile.email || null, dateOfBirth: profile.dateOfBirth ? new Date(profile.dateOfBirth) : null, publicId } });
    if (plan) {
      const { subscription } = await createBilledSubscription(tx, { memberId: created.id, plan, startDate, endDate: membershipEndDate ? new Date(`${membershipEndDate}T00:00:00.000Z`) : undefined, discount: body.membershipDiscount });
      if (seatId) {
        await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${seatId}::uuid FOR UPDATE`;
        const [seat, shift, room] = await Promise.all([tx.seat.findUnique({ where: { id: seatId } }), permanentShift(tx), primaryRoom(tx)]);
        if (!seat?.active || seat.roomId !== room.id || seat.status === SeatStatus.MAINTENANCE || seat.status === SeatStatus.DISABLED) throw new AppError(409, "The selected seat is no longer available.", "SEAT_UNAVAILABLE");
        const conflicts = await tx.seatAllocation.findMany({ where: { seatId, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: subscription.endDate }, endDate: { gte: startDate } }, include: { shift: true } });
        if (conflicts.some(item => shiftsOverlap(shift, item.shift))) throw new AppError(409, "The selected seat is no longer available for this membership period.", "SEAT_CONFLICT");
        await tx.seatAllocation.create({ data: { memberId: created.id, seatId, shiftId: shift.id, startDate, endDate: subscription.endDate, status: startDate > today ? AllocationStatus.UPCOMING : AllocationStatus.ACTIVE } });
        if (startDate <= today && subscription.endDate >= today) await tx.seat.update({ where: { id: seat.id }, data: { status: SeatStatus.ALLOCATED } });
      }
    }
    return created;
  });
  await audit(req, "MEMBER_CREATED", "Member", member.id, { publicId: member.publicId, fullName: member.fullName, membershipPlanId: body.membershipPlanId, seatAssigned: Boolean(body.seatId) }); ok(res.status(201), member);
}));
membersRouter.get("/registration-seats", asyncHandler(async (req, res) => {
  const query = z.object({ planId: z.string().uuid(), startDate: z.string().date(), endDate: z.string().date().optional() }).parse(req.query);
  const today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE), startDate = new Date(`${query.startDate}T00:00:00.000Z`);
  if (startDate < today) throw new AppError(422, "Membership cannot start in the past.", "PAST_MEMBERSHIP");
  const [plan, shift, room] = await Promise.all([prisma.membershipPlan.findUnique({ where: { id: query.planId } }), permanentShift(prisma), primaryRoom(prisma)]);
  if (!plan?.active) throw new AppError(422, "Select an active membership plan.", "MEMBERSHIP_PLAN_REQUIRED");
  if (!plan.studyAccess) return ok(res, []);
  const endDate = membershipQuote(plan, startDate, query.endDate ? new Date(`${query.endDate}T00:00:00.000Z`) : undefined).endDate;
  const seats = await prisma.seat.findMany({ where: { roomId: room.id, active: true, status: { notIn: [SeatStatus.MAINTENANCE, SeatStatus.DISABLED] } }, include: { allocations: { where: { status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: endDate }, endDate: { gte: startDate } }, include: { shift: true } } }, orderBy: { number: "asc" } });
  ok(res, seats.filter(seat => !seat.allocations.some(item => shiftsOverlap(shift, item.shift))).map(({ allocations: _allocations, ...seat }) => seat), { startDate: query.startDate, endDate: endDate.toISOString().slice(0, 10) });
}));
membersRouter.get("/:id", asyncHandler(async (req, res) => {
  const member = await prisma.member.findUnique({ where: { id: String(req.params.id) }, include: { subscriptions: { include: { plan: true, invoice: true }, orderBy: { createdAt: "desc" } }, allocations: { include: { seat: { include: { room: true } }, shift: true }, orderBy: { createdAt: "desc" } }, attendances: { orderBy: { checkInAt: "desc" }, take: 50 }, loans: { include: { copy: { include: { book: true } } }, orderBy: { createdAt: "desc" } }, payments: { include: { refunds: true }, orderBy: { paidAt: "desc" } }, invoices: { where: { status: { in: ["ISSUED", "PARTIAL"] } }, orderBy: { createdAt: "desc" } }, fines: { orderBy: { createdAt: "desc" } } } });
  if (!member) throw new AppError(404, "Member not found."); ok(res, { ...member, financialSummary: financialSummary({ payments: member.payments, invoices: member.invoices, fines: member.fines.filter(fine => ["UNPAID", "PARTIAL"].includes(fine.status)) }) });
}));
membersRouter.patch("/:id", asyncHandler(async (req, res) => {
  const parsed = input.partial().extend({ membershipPlanId: z.string().uuid().optional(), membershipStartDate: z.string().date().optional(), membershipDiscount: z.coerce.number().nonnegative().optional() }).parse(req.body);
  const { membershipPlanId, membershipStartDate, membershipDiscount, ...body } = parsed, id = String(req.params.id), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  const existing = await prisma.member.findUnique({ where: { id }, include: { subscriptions: { where: { status: "ACTIVE", startDate: { lte: today }, endDate: { gte: today } }, include: { invoice: true }, orderBy: { startDate: "desc" } }, loans: { where: { status: { in: ["ACTIVE", "OVERDUE"] } } }, reservations: { where: { status: { in: ["WAITING", "READY"] } } }, allocations: { where: { status: { in: ["ACTIVE", "UPCOMING"] }, endDate: { gte: today } } } } });
  if (!existing) throw new AppError(404, "Member not found.");
  const current = existing.subscriptions[0], replacingPlan = Boolean(membershipPlanId && membershipPlanId !== current?.planId);
  if (body.type && body.type !== existing.type && !membershipPlanId) throw new AppError(422, "Select the membership plan that should provide the new member type.", "PLAN_REQUIRED_FOR_TYPE_CHANGE");
  let plan = membershipPlanId ? await prisma.membershipPlan.findUnique({ where: { id: membershipPlanId }, include: { allowedShifts: true } }) : null;
  if (membershipPlanId && (!plan || !plan.active)) throw new AppError(400, "The selected active membership plan was not found.");
  if (plan && body.type && memberTypeForPlan(plan) !== body.type) throw new AppError(422, "The selected plan does not match the requested member type.", "PLAN_TYPE_MISMATCH");
  if (replacingPlan && plan) {
    if (!plan.studyAccess && existing.allocations.length) throw new AppError(409, "Release current and upcoming study seats before changing to a plan without study access.", "ACTIVE_SEAT_ACCESS");
    if (!plan.bookAccess && (existing.loans.length || existing.reservations.length)) throw new AppError(409, "Return active loans and cancel reservations before changing to a plan without book access.", "ACTIVE_BOOK_ACCESS");
    if (existing.subscriptions.some(subscription => subscription.invoice && Number(subscription.invoice.paid) > 0)) throw new AppError(409, "Refund or adjust the paid membership before replacing its plan.", "PAID_MEMBERSHIP_REPLACEMENT");
  }
  const member = await prisma.$transaction(async tx => {
    if (replacingPlan && plan) {
      for (const subscription of existing.subscriptions) { if (subscription.invoice) await tx.invoice.update({ where: { id: subscription.invoice.id }, data: { status: "VOID" } }); await tx.subscription.update({ where: { id: subscription.id }, data: { status: "CANCELLED" } }); }
      await createBilledSubscription(tx, { memberId: id, plan, startDate: membershipStartDate ? new Date(membershipStartDate) : today, discount: membershipDiscount ?? 0 });
    }
    const { type: _requestedType, ...editable } = body;
    return tx.member.update({ where: { id }, data: { ...editable, ...(plan ? { type: memberTypeForPlan(plan) } : {}), email: body.email === "" ? null : body.email, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : body.dateOfBirth } });
  });
  await audit(req, "MEMBER_UPDATED", "Member", member.id, { fields: Object.keys(body), membershipPlanId, replacedPlan: replacingPlan });
  ok(res, member);
}));
membersRouter.post("/:id/archive", asyncHandler(async (req, res) => { const member = await prisma.member.update({ where: { id: String(req.params.id) }, data: { status: RecordStatus.ARCHIVED } }); await audit(req, "MEMBER_ARCHIVED", "Member", member.id); ok(res, member); }));
