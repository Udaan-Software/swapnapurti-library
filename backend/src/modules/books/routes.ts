import { BookCopyStatus, LoanStatus, ReservationStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok, pageParams } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { addDays, differenceInCalendarDays } from "date-fns";

export const booksRouter = Router(); export const loansRouter = Router(); export const reservationsRouter = Router();
booksRouter.get("/categories", asyncHandler(async (_req, res) => ok(res, await prisma.bookCategory.findMany({ orderBy: { name: "asc" } }))));
booksRouter.get("/", asyncHandler(async (req, res) => { const { page, pageSize, skip } = pageParams(req); const search = String(req.query.search ?? ""); const where = { archived: false, ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { authors: { contains: search, mode: "insensitive" as const } }, { isbn: { contains: search } }] } : {}) }; const [items, total] = await prisma.$transaction([prisma.book.findMany({ where, skip, take: pageSize, include: { category: true, copies: true }, orderBy: { title: "asc" } }), prisma.book.count({ where })]); ok(res, items, { page, pageSize, total }); }));
booksRouter.post("/", asyncHandler(async (req, res) => { const body = z.object({ title: z.string().min(1), authors: z.string().min(1), isbn: z.string().optional().nullable(), publisher: z.string().optional().nullable(), edition: z.string().optional().nullable(), publicationYear: z.number().int().min(1000).max(2200).optional().nullable(), categoryId: z.string().uuid().optional().nullable(), language: z.string().default("English"), description: z.string().optional().nullable(), shelfLocation: z.string().optional().nullable(), copies: z.number().int().min(0).max(500).default(0) }).parse(req.body); const book = await prisma.$transaction(async tx => { const created = await tx.book.create({ data: { ...body, copies: undefined } }); if (body.copies) { const base = Date.now().toString().slice(-8); await tx.bookCopy.createMany({ data: Array.from({ length: body.copies }, (_, i) => ({ bookId: created.id, accessionNumber: `ACC-${base}-${String(i + 1).padStart(3, "0")}`, barcode: `SWPB${base}${String(i + 1).padStart(3, "0")}` })) }); } return created; }); await audit(req, "BOOK_CREATED", "Book", book.id, { title: book.title, copies: body.copies }); ok(res.status(201), book); }));
booksRouter.post("/:id/copies", asyncHandler(async (req, res) => { const body = z.object({ accessionNumber: z.string().min(3), barcode: z.string().min(3), condition: z.string().default("GOOD"), purchasePrice: z.coerce.number().nonnegative().optional() }).parse(req.body); const copy = await prisma.bookCopy.create({ data: { ...body, purchasePrice: body.purchasePrice?.toFixed(2), bookId: String(req.params.id) } }); await audit(req, "BOOK_COPY_CREATED", "BookCopy", copy.id); ok(res.status(201), copy); }));
loansRouter.get("/", asyncHandler(async (req, res) => { const where = req.query.status ? { status: req.query.status as LoanStatus } : {}; ok(res, await prisma.bookLoan.findMany({ where, include: { member: true, copy: { include: { book: true } }, fines: true }, orderBy: { createdAt: "desc" }, take: 200 })); }));
loansRouter.post("/issue", asyncHandler(async (req, res) => { const body = z.object({ memberId: z.string().uuid(), copyId: z.string().uuid() }).parse(req.body); const today = new Date(); const loan = await prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "BookCopy" WHERE id = ${body.copyId}::uuid FOR UPDATE`; const copy = await tx.bookCopy.findUnique({ where: { id: body.copyId } }); if (!copy || copy.status !== BookCopyStatus.AVAILABLE) throw new AppError(409, "This copy is not available.", "COPY_UNAVAILABLE"); const access = await tx.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: today }, endDate: { gte: today }, plan: { bookAccess: true } }, include: { plan: true }, orderBy: { endDate: "desc" } }); if (!access) throw new AppError(409, "Member does not have active book borrowing access.", "NO_BOOK_ACCESS"); const activeCount = await tx.bookLoan.count({ where: { memberId: body.memberId, status: { in: [LoanStatus.ACTIVE, LoanStatus.OVERDUE] } } }); if (activeCount >= access.plan.maxBooks) throw new AppError(409, "Member has reached their borrowing limit.", "LOAN_LIMIT"); const created = await tx.bookLoan.create({ data: { memberId: body.memberId, copyId: body.copyId, issueDate: today, dueDate: addDays(today, access.plan.loanDays), conditionAtIssue: copy.condition } }); await tx.bookCopy.update({ where: { id: copy.id }, data: { status: BookCopyStatus.ISSUED } }); return created; }); await audit(req, "BOOK_ISSUED", "BookLoan", loan.id, body); ok(res.status(201), loan); }));
loansRouter.post("/:id/return", asyncHandler(async (req, res) => {
  const body = z.object({ condition: z.string().min(2), returnDate: z.string().date().optional() }).parse(req.body);
  const returned = body.returnDate ? new Date(body.returnDate) : new Date();
  const settings = await prisma.appSetting.findUnique({ where: { key: "books" } });
  const rules = settings?.value as { finePerDay?: string; reservationDays?: number } | null;
  const fineRate = Number(rules?.finePerDay ?? "5"); const reservationDays = Number(rules?.reservationDays ?? 2);
  const result = await prisma.$transaction(async tx => {
    const loan = await tx.bookLoan.findUnique({ where: { id: String(req.params.id) }, include: { copy: true } });
    if (!loan || !(loan.status === LoanStatus.ACTIVE || loan.status === LoanStatus.OVERDUE)) throw new AppError(409, "Active loan not found.");
    await tx.$queryRaw`SELECT id FROM "BookCopy" WHERE id = ${loan.copyId}::uuid FOR UPDATE`;
    const overdueDays = Math.max(0, differenceInCalendarDays(returned, loan.dueDate));
    const updated = await tx.bookLoan.update({ where: { id: loan.id }, data: { actualReturnDate: returned, conditionAtReturn: body.condition, status: LoanStatus.RETURNED } });
    const waiting = await tx.bookReservation.findFirst({ where: { bookId: loan.copy.bookId, status: ReservationStatus.WAITING }, orderBy: [{ queueNumber: "asc" }, { createdAt: "asc" }] });
    let reservation = null;
    if (waiting) {
      const readyAt = new Date(); reservation = await tx.bookReservation.update({ where: { id: waiting.id }, data: { status: ReservationStatus.READY, readyAt, expiresAt: addDays(readyAt, reservationDays) } });
      await tx.bookCopy.update({ where: { id: loan.copyId }, data: { status: BookCopyStatus.RESERVED, condition: body.condition } });
      await tx.notification.create({ data: { memberId: waiting.memberId, type: "RESERVATION_READY", title: "Reserved book is ready", message: "A reserved title is ready for pickup." } });
    } else await tx.bookCopy.update({ where: { id: loan.copyId }, data: { status: BookCopyStatus.AVAILABLE, condition: body.condition } });
    const fine = overdueDays ? await tx.fine.create({ data: { memberId: loan.memberId, loanId: loan.id, type: "OVERDUE_FINE", amount: (overdueDays * fineRate).toFixed(2), reason: `${overdueDays} overdue day(s)` } }) : null;
    return { loan: updated, fine, reservation };
  });
  await audit(req, "BOOK_RETURNED", "BookLoan", result.loan.id); ok(res, result);
}));
loansRouter.post("/:id/renew", asyncHandler(async (req, res) => { const loan = await prisma.$transaction(async tx => { const existing = await tx.bookLoan.findUnique({ where: { id: String(req.params.id) }, include: { copy: { include: { book: { include: { reservations: { where: { status: ReservationStatus.WAITING } } } } } }, member: { include: { subscriptions: { where: { status: "ACTIVE", plan: { bookAccess: true } }, include: { plan: true } } } } } }); if (!existing || existing.status !== LoanStatus.ACTIVE) throw new AppError(409, "Only an active loan can be renewed."); const plan = existing.member.subscriptions[0]?.plan; if (!plan || existing.renewalCount >= plan.renewalLimit) throw new AppError(409, "Renewal limit has been reached."); if (existing.copy.book.reservations.length) throw new AppError(409, "This title has a waiting reservation and cannot be renewed."); const newDue = addDays(existing.dueDate, plan.loanDays); await tx.loanRenewalHistory.create({ data: { loanId: existing.id, oldDueDate: existing.dueDate, newDueDate: newDue } }); return tx.bookLoan.update({ where: { id: existing.id }, data: { dueDate: newDue, renewalCount: { increment: 1 } } }); }); await audit(req, "BOOK_RENEWED", "BookLoan", loan.id); ok(res, loan); }));
reservationsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.bookReservation.findMany({ include: { member: true, book: true }, orderBy: [{ bookId: "asc" }, { queueNumber: "asc" }] }))));
reservationsRouter.post("/", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), bookId: z.string().uuid() }).parse(req.body); const now = new Date();
  const item = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${body.bookId}::uuid FOR UPDATE`;
    const [access, available, duplicate] = await Promise.all([
      tx.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: now }, endDate: { gte: now }, plan: { bookAccess: true } } }),
      tx.bookCopy.count({ where: { bookId: body.bookId, status: BookCopyStatus.AVAILABLE } }),
      tx.bookReservation.findFirst({ where: { memberId: body.memberId, bookId: body.bookId, status: { in: [ReservationStatus.WAITING, ReservationStatus.READY] } } })
    ]);
    if (!access) throw new AppError(409, "Member does not have active book borrowing access.", "NO_BOOK_ACCESS");
    if (available) throw new AppError(409, "This title has an available copy and should be issued directly.", "COPY_AVAILABLE");
    if (duplicate) throw new AppError(409, "Member already has an active reservation for this title.", "DUPLICATE_RESERVATION");
    const last = await tx.bookReservation.aggregate({ where: { bookId: body.bookId }, _max: { queueNumber: true } });
    return tx.bookReservation.create({ data: { ...body, queueNumber: (last._max.queueNumber ?? 0) + 1 } });
  });
  await audit(req, "BOOK_RESERVED", "BookReservation", item.id, body); ok(res.status(201), item);
}));
reservationsRouter.post("/:id/cancel", asyncHandler(async (req, res) => {
  const reservation = await prisma.bookReservation.findUnique({ where: { id: String(req.params.id) } });
  if (!reservation || !(reservation.status === ReservationStatus.WAITING || reservation.status === ReservationStatus.READY)) throw new AppError(409, "Only a waiting or ready reservation can be cancelled.");
  const updated = await prisma.$transaction(async tx => {
    const item = await tx.bookReservation.update({ where: { id: reservation.id }, data: { status: ReservationStatus.CANCELLED } });
    if (reservation.status === ReservationStatus.READY) await tx.bookCopy.updateMany({ where: { bookId: reservation.bookId, status: BookCopyStatus.RESERVED }, data: { status: BookCopyStatus.AVAILABLE } });
    return item;
  });
  await audit(req, "RESERVATION_CANCELLED", "BookReservation", updated.id); ok(res, updated);
}));
