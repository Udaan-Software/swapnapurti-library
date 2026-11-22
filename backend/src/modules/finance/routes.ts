import { InvoiceStatus, PaymentMethod } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok } from "../../utils/http.js";
import { audit } from "../../services/audit.js";

export const paymentsRouter = Router(); export const expensesRouter = Router(); export const finesRouter = Router();
paymentsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.payment.findMany({ include: { member: true, refunds: true, allocations: { include: { invoice: true } } }, orderBy: { paidAt: "desc" }, take: 200 }))));
paymentsRouter.get("/invoices", asyncHandler(async (_req, res) => ok(res, await prisma.invoice.findMany({ include: { member: true, items: true }, orderBy: { createdAt: "desc" }, take: 200 }))));
paymentsRouter.post("/invoices", asyncHandler(async (req, res) => { const body = z.object({ memberId: z.string().uuid(), dueDate: z.string().date().optional(), items: z.array(z.object({ type: z.enum(["SUBSCRIPTION", "OVERDUE_FINE", "LOST_BOOK", "DAMAGED_BOOK", "SECURITY_DEPOSIT", "OTHER"]), description: z.string().min(2), quantity: z.number().int().positive().default(1), unitAmount: z.coerce.number().nonnegative() })).min(1) }).parse(req.body); const invoice = await prisma.$transaction(async tx => { const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('invoice_number_seq') AS value`; const total = body.items.reduce((sum, i) => sum + i.quantity * i.unitAmount, 0); return tx.invoice.create({ data: { invoiceNo: `SWP-INV-${String(rows[0]!.value).padStart(6, "0")}`, memberId: body.memberId, total: total.toFixed(2), dueDate: body.dueDate ? new Date(body.dueDate) : null, items: { create: body.items.map(i => ({ ...i, unitAmount: i.unitAmount.toFixed(2), total: (i.quantity * i.unitAmount).toFixed(2) })) } }, include: { items: true } }); }); await audit(req, "INVOICE_CREATED", "Invoice", invoice.id, { total: invoice.total.toString() }); ok(res.status(201), invoice); }));
paymentsRouter.post("/", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), invoiceId: z.string().uuid(), amount: z.coerce.number().positive(), method: z.nativeEnum(PaymentMethod), reference: z.string().optional(), idempotencyKey: z.string().max(100).optional() }).parse(req.body);
  if (body.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey }, include: { allocations: true } });
    if (existing) {
      const matches = existing.memberId === body.memberId && Number(existing.amount) === body.amount && existing.method === body.method && existing.allocations.some(a => a.invoiceId === body.invoiceId);
      if (!matches) throw new AppError(409, "This idempotency key was already used for a different payment.", "IDEMPOTENCY_CONFLICT");
      return ok(res, existing);
    }
  }
  const payment = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${body.invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findUnique({ where: { id: body.invoiceId } });
    if (!invoice || invoice.memberId !== body.memberId) throw new AppError(400, "Invoice does not belong to this member.");
    const remaining = Number(invoice.total) - Number(invoice.paid);
    if (body.amount > remaining) throw new AppError(422, "Payment exceeds the outstanding balance.");
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('receipt_number_seq') AS value`;
    const item = await tx.payment.create({ data: { receiptNo: `SWP-RCPT-${String(rows[0]!.value).padStart(6, "0")}`, memberId: body.memberId, amount: body.amount.toFixed(2), method: body.method, reference: body.reference, idempotencyKey: body.idempotencyKey, allocations: { create: { invoiceId: invoice.id, amount: body.amount.toFixed(2) } } } });
    const paid = Number(invoice.paid) + body.amount;
    await tx.invoice.update({ where: { id: invoice.id }, data: { paid: paid.toFixed(2), status: paid === Number(invoice.total) ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL } });
    if (invoice.subscriptionId) await tx.subscription.update({ where: { id: invoice.subscriptionId }, data: { paymentStatus: paid === Number(invoice.total) ? "PAID" : "PARTIAL" } });
    return item;
  });
  await audit(req, "PAYMENT_RECORDED", "Payment", payment.id, { amount: payment.amount.toString(), method: payment.method }); ok(res.status(201), payment);
}));
paymentsRouter.post("/:id/refund", asyncHandler(async (req, res) => {
  const body = z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(5).max(500) }).parse(req.body);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${String(req.params.id)}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: String(req.params.id) }, include: { refunds: true, allocations: true } });
    if (!payment) throw new AppError(404, "Payment not found.");
    const remaining = Number(payment.amount) - payment.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    if (body.amount > remaining) throw new AppError(422, "Refund exceeds the refundable payment balance.");
    if (payment.allocations.length !== 1) throw new AppError(409, "This payment requires a manual allocation review before refunding.");
    const allocation = payment.allocations[0]!;
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
    const paid = Math.max(0, Number(invoice.paid) - body.amount);
    const refund = await tx.refund.create({ data: { paymentId: payment.id, amount: body.amount.toFixed(2), reason: body.reason } });
    await tx.invoice.update({ where: { id: invoice.id }, data: { paid: paid.toFixed(2), status: paid === 0 ? InvoiceStatus.ISSUED : paid < Number(invoice.total) ? InvoiceStatus.PARTIAL : InvoiceStatus.PAID } });
    if (invoice.subscriptionId) await tx.subscription.update({ where: { id: invoice.subscriptionId }, data: { paymentStatus: paid === 0 ? "UNPAID" : "PARTIAL" } });
    return refund;
  });
  await audit(req, "PAYMENT_REFUNDED", "Payment", String(req.params.id), { amount: body.amount }, body.reason); ok(res.status(201), result);
}));
expensesRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.expense.findMany({ orderBy: { expenseDate: "desc" }, take: 500 }))));
expensesRouter.post("/", asyncHandler(async (req, res) => { const body = z.object({ category: z.string().min(2), description: z.string().min(2), amount: z.coerce.number().positive(), expenseDate: z.string().date(), method: z.nativeEnum(PaymentMethod), reference: z.string().optional(), notes: z.string().optional() }).parse(req.body); const item = await prisma.expense.create({ data: { ...body, amount: body.amount.toFixed(2), expenseDate: new Date(body.expenseDate) } }); await audit(req, "EXPENSE_CREATED", "Expense", item.id, { amount: item.amount.toString(), category: item.category }); ok(res.status(201), item); }));
expensesRouter.patch("/:id", asyncHandler(async (req, res) => { const body = z.object({ category: z.string().min(2).optional(), description: z.string().min(2).optional(), amount: z.coerce.number().positive().optional(), expenseDate: z.string().date().optional(), method: z.nativeEnum(PaymentMethod).optional(), reference: z.string().optional().nullable(), notes: z.string().optional().nullable() }).parse(req.body); const item = await prisma.expense.update({ where: { id: String(req.params.id) }, data: { ...body, amount: body.amount?.toFixed(2), expenseDate: body.expenseDate ? new Date(body.expenseDate) : undefined } }); await audit(req, "EXPENSE_UPDATED", "Expense", item.id, body); ok(res, item); }));
finesRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.fine.findMany({ include: { member: true, loan: { include: { copy: { include: { book: true } } } } }, orderBy: { createdAt: "desc" } }))));
finesRouter.post("/:id/waive", asyncHandler(async (req, res) => { const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body); const fine = await prisma.fine.findUnique({ where: { id: String(req.params.id) } }); if (!fine || !["UNPAID", "PARTIAL"].includes(fine.status)) throw new AppError(409, "Only an unpaid or partially paid fine can be waived."); const updated = await prisma.fine.update({ where: { id: fine.id }, data: { status: "WAIVED", adjustmentReason: reason } }); await audit(req, "FINE_WAIVED", "Fine", fine.id, { priorStatus: fine.status }, reason); ok(res, updated); }));
