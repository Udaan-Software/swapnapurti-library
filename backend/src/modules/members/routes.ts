import { MemberType, Prisma, RecordStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { asyncHandler, AppError, ok, pageParams } from "../../utils/http.js";
import { audit } from "../../services/audit.js";

export const membersRouter = Router();
const input = z.object({ fullName: z.string().trim().min(2).max(120), mobile: z.string().regex(/^[0-9+ -]{8,16}$/), email: z.string().email().optional().or(z.literal("")), dateOfBirth: z.string().date().optional().nullable(), gender: z.string().max(30).optional().nullable(), address: z.string().max(500).optional().nullable(), emergencyContact: z.string().max(50).optional().nullable(), type: z.nativeEnum(MemberType), status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE), notes: z.string().max(2000).optional().nullable() });
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
  const [items, total] = await prisma.$transaction([prisma.member.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" }, include: { subscriptions: { where: { status: "ACTIVE" }, orderBy: { endDate: "desc" }, take: 1 }, payments: { select: { amount: true, refunds: { select: { amount: true } } } }, invoices: { where: { status: { in: ["ISSUED", "PARTIAL"] } }, select: { total: true, paid: true } }, fines: { where: { status: { in: ["UNPAID", "PARTIAL"] } }, select: { amount: true, paidAmount: true } } } }), prisma.member.count({ where })]);
  ok(res, items.map(({ payments, invoices, fines, ...member }) => ({ ...member, financialSummary: financialSummary({ payments, invoices, fines }) })), { page, pageSize, total, pages: Math.ceil(total / pageSize) });
}));
membersRouter.post("/", asyncHandler(async (req, res) => {
  const body = input.parse(req.body);
  const member = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('member_public_id_seq') AS value`;
    const publicId = `SWP-${String(rows[0]!.value).padStart(6, "0")}`;
    return tx.member.create({ data: { ...body, email: body.email || null, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, publicId } });
  });
  await audit(req, "MEMBER_CREATED", "Member", member.id, { publicId: member.publicId, fullName: member.fullName }); ok(res.status(201), member);
}));
membersRouter.get("/:id", asyncHandler(async (req, res) => {
  const member = await prisma.member.findUnique({ where: { id: String(req.params.id) }, include: { subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" } }, allocations: { include: { seat: { include: { room: true } }, shift: true }, orderBy: { createdAt: "desc" } }, attendances: { orderBy: { checkInAt: "desc" }, take: 50 }, loans: { include: { copy: { include: { book: true } } }, orderBy: { createdAt: "desc" } }, payments: { include: { refunds: true }, orderBy: { paidAt: "desc" } }, invoices: { where: { status: { in: ["ISSUED", "PARTIAL"] } }, orderBy: { createdAt: "desc" } }, fines: { orderBy: { createdAt: "desc" } } } });
  if (!member) throw new AppError(404, "Member not found."); ok(res, { ...member, financialSummary: financialSummary({ payments: member.payments, invoices: member.invoices, fines: member.fines.filter(fine => ["UNPAID", "PARTIAL"].includes(fine.status)) }) });
}));
membersRouter.patch("/:id", asyncHandler(async (req, res) => {
  const body = input.partial().parse(req.body);
  const member = await prisma.member.update({
    where: { id: String(req.params.id) },
    data: {
      ...body,
      email: body.email === "" ? null : body.email,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : body.dateOfBirth,
    },
  });
  await audit(req, "MEMBER_UPDATED", "Member", member.id, { fields: Object.keys(body) });
  ok(res, member);
}));
membersRouter.post("/:id/archive", asyncHandler(async (req, res) => { const member = await prisma.member.update({ where: { id: String(req.params.id) }, data: { status: RecordStatus.ARCHIVED } }); await audit(req, "MEMBER_ARCHIVED", "Member", member.id); ok(res, member); }));
