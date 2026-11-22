import { AllocationStatus, AttendanceStatus, Prisma, SeatStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { dateInTimeZone, periodsCoverRange, periodsOverlap, shiftTimingIssue, shiftsOverlap } from "../../services/rules.js";
import { env } from "../../config/env.js";

export const roomsRouter = Router(); export const shiftsRouter = Router(); export const allocationsRouter = Router(); export const attendanceRouter = Router();
const allocationStatuses = [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING];
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
type StudyDb = Prisma.TransactionClient | typeof prisma;
async function requireStudyCoverage(db: StudyDb, memberId: string, shiftId: string, start: Date, end: Date) {
  const subscriptions = await db.subscription.findMany({
    where: { memberId, status: "ACTIVE", startDate: { lte: end }, endDate: { gte: start } },
    include: { plan: { include: { allowedShifts: true } } },
    orderBy: { startDate: "asc" },
  });
  const studySubscriptions = subscriptions.filter(subscription => {
    const snapshot = subscription.planSnapshot && typeof subscription.planSnapshot === "object" && !Array.isArray(subscription.planSnapshot) ? subscription.planSnapshot as Prisma.JsonObject : undefined;
    return typeof snapshot?.studyAccess === "boolean" ? snapshot.studyAccess : subscription.plan.studyAccess;
  });
  if (!periodsCoverRange(studySubscriptions, start, end)) throw new AppError(409, "Member does not have study access for the full allocation period.", "NO_STUDY_ACCESS");
  const allowed = studySubscriptions.filter(subscription => {
    const snapshot = subscription.planSnapshot && typeof subscription.planSnapshot === "object" && !Array.isArray(subscription.planSnapshot) ? subscription.planSnapshot as Prisma.JsonObject : undefined;
    const shiftIds = Array.isArray(snapshot?.shiftIds) ? snapshot.shiftIds.filter((id): id is string => typeof id === "string") : subscription.plan.allowedShifts.map(item => item.shiftId);
    return !shiftIds.length || shiftIds.includes(shiftId);
  });
  if (!periodsCoverRange(allowed, start, end)) throw new AppError(409, "The membership plan does not allow this shift for the full allocation period.", "SHIFT_NOT_ALLOWED");
}
roomsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.studyRoom.findMany({ include: { seats: { orderBy: { number: "asc" }, include: { allocations: { where: { status: { in: ["ACTIVE", "UPCOMING"] } }, include: { member: true, shift: true } } } } }, orderBy: { name: "asc" } }))));
roomsRouter.post("/", asyncHandler(async (req, res) => { const body = z.object({ name: z.string().min(2), floor: z.string().optional(), description: z.string().optional(), seatCount: z.coerce.number().int().min(0).max(500).default(0), seatPrefix: z.string().max(8).default("S") }).parse(req.body); const room = await prisma.$transaction(async tx => { const created = await tx.studyRoom.create({ data: { name: body.name, floor: body.floor, description: body.description } }); if (body.seatCount) await tx.seat.createMany({ data: Array.from({ length: body.seatCount }, (_, i) => ({ roomId: created.id, number: `${body.seatPrefix}${String(i + 1).padStart(2, "0")}` })) }); return created; }); await audit(req, "ROOM_CREATED", "StudyRoom", room.id, body); ok(res.status(201), room); }));
roomsRouter.patch("/:id", asyncHandler(async (req, res) => { const data = z.object({ name: z.string().trim().min(2).optional(), floor: z.string().optional().nullable(), description: z.string().optional().nullable(), active: z.boolean().optional() }).parse(req.body); if (data.active === false) { const allocated = await prisma.seatAllocation.count({ where: { seat: { roomId: String(req.params.id) }, status: { in: allocationStatuses }, endDate: { gte: dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE) } } }); if (allocated) throw new AppError(409, "Release or reassign this room's current and upcoming seats before deactivating it.", "ROOM_HAS_ALLOCATIONS"); } const room = await prisma.studyRoom.update({ where: { id: String(req.params.id) }, data }); await audit(req, "ROOM_UPDATED", "StudyRoom", room.id, { fields: Object.keys(data) }); ok(res, room); }));
roomsRouter.post("/:roomId/seats", asyncHandler(async (req, res) => { const data = z.object({ number: z.string().min(1), type: z.string().default("STANDARD") }).parse(req.body); const seat = await prisma.seat.create({ data: { roomId: String(req.params.roomId), ...data } }); await audit(req, "SEAT_CREATED", "Seat", seat.id); ok(res.status(201), seat); }));
roomsRouter.patch("/seats/:id", asyncHandler(async (req, res) => {
  const id = String(req.params.id), data = z.object({ status: z.nativeEnum(SeatStatus).optional(), notes: z.string().optional().nullable(), active: z.boolean().optional() }).parse(req.body);
  const current = await prisma.seat.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Seat not found.");
  const derived: SeatStatus[] = [SeatStatus.ALLOCATED, SeatStatus.RESERVED];
  if (data.status && data.status !== current.status && (derived.includes(data.status) || derived.includes(current.status))) throw new AppError(422, "Allocated and reserved statuses are controlled by seat transactions.", "DERIVED_SEAT_STATUS");
  if (data.active === false || data.status === SeatStatus.MAINTENANCE || data.status === SeatStatus.DISABLED) {
    const allocations = await prisma.seatAllocation.count({ where: { seatId: id, status: { in: allocationStatuses }, endDate: { gte: dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE) } } });
    if (allocations) throw new AppError(409, "Release or reassign this seat's current and upcoming allocations before disabling it.", "SEAT_HAS_ALLOCATIONS");
  }
  const seat = await prisma.seat.update({ where: { id }, data }); await audit(req, "SEAT_UPDATED", "Seat", seat.id); ok(res, seat);
}));
const shiftFields = z.object({ name: z.string().min(2), startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(0).max(1439), fullDay: z.boolean().default(false), crossesMidnight: z.boolean().default(false), active: z.boolean().default(true) });
const shiftInput = shiftFields.superRefine((value, context) => { const issue = shiftTimingIssue(value); if (issue) context.addIssue({ code: "custom", message: issue }); });
shiftsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.shift.findMany({ orderBy: { startMinutes: "asc" } }))));
shiftsRouter.post("/", asyncHandler(async (req, res) => { const data = shiftInput.parse(req.body); const shift = await prisma.shift.create({ data }); await audit(req, "SHIFT_CREATED", "Shift", shift.id, data); ok(res.status(201), shift); }));
shiftsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = String(req.params.id), data = shiftFields.partial().parse(req.body);
  const current = await prisma.shift.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Shift not found.");
  const proposed = shiftInput.parse({ ...current, ...data });
  const ownAllocations = await prisma.seatAllocation.findMany({ where: { shiftId: id, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] } } });
  if (ownAllocations.length) {
    const others = await prisma.seatAllocation.findMany({ where: { shiftId: { not: id }, seatId: { in: [...new Set(ownAllocations.map(item => item.seatId))] }, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] } }, include: { shift: true } });
    const conflict = ownAllocations.some(own => others.some(other => own.seatId === other.seatId && periodsOverlap(own.startDate, own.endDate, other.startDate, other.endDate) && shiftsOverlap(proposed, other.shift)));
    if (conflict) throw new AppError(409, "These shift times would conflict with existing seat allocations.", "SHIFT_ALLOCATION_CONFLICT");
  }
  const shift = await prisma.shift.update({ where: { id }, data });
  await audit(req, "SHIFT_UPDATED", "Shift", shift.id, { fields: Object.keys(data) });
  ok(res, shift);
}));
allocationsRouter.get("/available-seats", asyncHandler(async (req, res) => {
  const query = z.object({ memberId: z.string().uuid(), shiftId: z.string().uuid(), startDate: z.string().date(), endDate: z.string().date() }).parse(req.query);
  const start = asDate(query.startDate), end = asDate(query.endDate), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  if (start < today) throw new AppError(422, "A new seat allocation cannot start in the past.", "PAST_ALLOCATION");
  const [shift, seats, memberAllocations] = await Promise.all([
    prisma.shift.findUnique({ where: { id: query.shiftId } }),
    prisma.seat.findMany({
      where: { active: true, status: { notIn: [SeatStatus.MAINTENANCE, SeatStatus.DISABLED] } },
      include: { room: true, allocations: { where: { status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } } },
      orderBy: [{ room: { name: "asc" } }, { number: "asc" }],
    }),
    prisma.seatAllocation.findMany({ where: { memberId: query.memberId, status: { in: allocationStatuses }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true, seat: { include: { room: true } } } }),
  ]);
  if (!shift?.active) throw new AppError(409, "The selected shift is inactive.");
  await requireStudyCoverage(prisma, query.memberId, query.shiftId, start, end);
  const memberConflict = memberAllocations.find(allocation => shiftsOverlap(shift, allocation.shift));
  if (memberConflict) throw new AppError(409, `Member already has ${memberConflict.seat.room.name}, Seat ${memberConflict.seat.number} during an overlapping shift.`, "MEMBER_ALLOCATION_CONFLICT");
  const available = seats.filter(seat => !seat.allocations.some(allocation => shiftsOverlap(shift, allocation.shift))).map(({ allocations: _allocations, ...seat }) => seat);
  ok(res, available, { count: available.length });
}));
allocationsRouter.get("/seat-map", asyncHandler(async (req, res) => {
  const query = z.object({ shiftId: z.string().uuid(), date: z.string().date() }).parse(req.query);
  const date = asDate(query.date), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (date < today) throw new AppError(422, "The live seat map is available for today and future dates.", "PAST_SEAT_MAP");
  const [shift, rooms] = await Promise.all([
    prisma.shift.findUnique({ where: { id: query.shiftId } }),
    prisma.studyRoom.findMany({ include: { seats: { orderBy: { number: "asc" }, include: { allocations: { where: { status: { in: allocationStatuses }, startDate: { lte: date }, endDate: { gte: date } }, include: { member: { select: { id: true, publicId: true, fullName: true, mobile: true } }, shift: true } } } } }, orderBy: { name: "asc" } }),
  ]);
  if (!shift) throw new AppError(404, "Shift not found.");
  const checkedIn = date.getTime() === today.getTime() ? new Set((await prisma.attendance.findMany({ where: { status: AttendanceStatus.OPEN, shiftId: shift.id }, select: { memberId: true } })).map(item => item.memberId)) : new Set<string>();
  const result = rooms.map(room => ({ ...room, seats: room.seats.map(seat => {
    const allocation = seat.allocations.find(item => shiftsOverlap(shift, item.shift));
    const unavailable = !room.active || !seat.active || seat.status === SeatStatus.DISABLED;
    const displayStatus = unavailable ? "DISABLED" : seat.status === SeatStatus.MAINTENANCE ? "MAINTENANCE" : allocation ? (checkedIn.has(allocation.memberId) ? "OCCUPIED" : "RESERVED") : "AVAILABLE";
    return { id: seat.id, number: seat.number, type: seat.type, notes: seat.notes, active: seat.active, status: seat.status, displayStatus, allocation: allocation ? { id: allocation.id, startDate: allocation.startDate, endDate: allocation.endDate, status: allocation.status, member: allocation.member, shift: { id: allocation.shift.id, name: allocation.shift.name } } : null };
  }) }));
  ok(res, result, { shift: { id: shift.id, name: shift.name }, date: query.date });
}));
allocationsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.seatAllocation.findMany({ include: { member: true, seat: { include: { room: true } }, shift: true }, orderBy: { createdAt: "desc" }, take: 200 }))));
allocationsRouter.post("/", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), seatId: z.string().uuid(), shiftId: z.string().uuid(), startDate: z.string().date(), endDate: z.string().date() }).parse(req.body);
  const start = asDate(body.startDate), end = asDate(body.endDate), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  if (start < today) throw new AppError(422, "A new seat allocation cannot start in the past.", "PAST_ALLOCATION");
  const allocation = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${body.memberId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${body.seatId}::uuid FOR UPDATE`;
    const [seat, requestedShift] = await Promise.all([
      tx.seat.findUnique({ where: { id: body.seatId } }),
      tx.shift.findUnique({ where: { id: body.shiftId } }),
    ]);
    if (!seat?.active || seat.status === SeatStatus.MAINTENANCE || seat.status === SeatStatus.DISABLED) throw new AppError(409, "This seat is unavailable for allocation.", "SEAT_UNAVAILABLE");
    if (!requestedShift?.active) throw new AppError(409, "The selected shift is inactive.");
    await requireStudyCoverage(tx, body.memberId, body.shiftId, start, end);
    const existing = await tx.seatAllocation.findMany({ where: { seatId: body.seatId, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } });
    if (existing.some(x => shiftsOverlap(requestedShift, x.shift))) throw new AppError(409, "This seat is already allocated for an overlapping date and shift.", "SEAT_CONFLICT");
    const memberAllocations = await tx.seatAllocation.findMany({ where: { memberId: body.memberId, status: { in: allocationStatuses }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } });
    if (memberAllocations.some(item => shiftsOverlap(requestedShift, item.shift))) throw new AppError(409, "This member already has a seat during an overlapping date and shift.", "MEMBER_ALLOCATION_CONFLICT");
    const created = await tx.seatAllocation.create({ data: { ...body, startDate: start, endDate: end, status: start > today ? AllocationStatus.UPCOMING : AllocationStatus.ACTIVE } });
    if (start <= today && end >= today) await tx.seat.update({ where: { id: seat.id }, data: { status: SeatStatus.ALLOCATED } });
    return created;
  });
  await audit(req, "SEAT_ALLOCATED", "SeatAllocation", allocation.id, body); ok(res.status(201), allocation);
}));
allocationsRouter.post("/:id/release", asyncHandler(async (req, res) => {
  const item = await prisma.$transaction(async tx => {
    const released = await tx.seatAllocation.update({ where: { id: String(req.params.id) }, data: { status: AllocationStatus.RELEASED, endDate: new Date() } });
    const remaining = await tx.seatAllocation.count({ where: { seatId: released.seatId, status: AllocationStatus.ACTIVE, startDate: { lte: new Date() }, endDate: { gte: new Date() }, id: { not: released.id } } });
    if (!remaining) await tx.seat.updateMany({ where: { id: released.seatId, status: SeatStatus.ALLOCATED }, data: { status: SeatStatus.AVAILABLE } });
    return released;
  });
  await audit(req, "SEAT_RELEASED", "SeatAllocation", item.id); ok(res, item);
}));
attendanceRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.attendance.findMany({ include: { member: true, shift: true }, orderBy: { checkInAt: "desc" }, take: 200 }))));
attendanceRouter.post("/check-in", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), shiftId: z.string().uuid().optional() }).parse(req.body); const now = new Date(), today = dateInTimeZone(now, env.LIBRARY_TIMEZONE);
  const access = await prisma.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: today }, endDate: { gte: today }, plan: { studyAccess: true } }, include: { plan: { include: { allowedShifts: true } } } });
  if (!access) throw new AppError(409, "Member does not have active study access.", "NO_STUDY_ACCESS");
  if (access.plan.allowedShifts.length && (!body.shiftId || !access.plan.allowedShifts.some(x => x.shiftId === body.shiftId))) throw new AppError(409, "The membership plan does not allow this shift.", "SHIFT_NOT_ALLOWED");
  const attendance = await prisma.$transaction(async tx => { const open = await tx.attendance.findFirst({ where: { memberId: body.memberId, status: AttendanceStatus.OPEN } }); if (open) throw new AppError(409, "Member is already checked in.", "ALREADY_CHECKED_IN"); return tx.attendance.create({ data: { ...body, checkInAt: now } }); });
  await audit(req, "ATTENDANCE_CHECK_IN", "Attendance", attendance.id); ok(res.status(201), attendance);
}));
attendanceRouter.post("/:id/check-out", asyncHandler(async (req, res) => { const item = await prisma.attendance.findUnique({ where: { id: String(req.params.id) } }); if (!item || item.status !== AttendanceStatus.OPEN) throw new AppError(409, "No open attendance session was found."); const updated = await prisma.attendance.update({ where: { id: item.id }, data: { checkOutAt: new Date(), status: AttendanceStatus.COMPLETED } }); await audit(req, "ATTENDANCE_CHECK_OUT", "Attendance", item.id); ok(res, updated); }));
attendanceRouter.patch("/:id/correct", asyncHandler(async (req, res) => { const body = z.object({ checkInAt: z.string().datetime(), checkOutAt: z.string().datetime().optional().nullable(), shiftId: z.string().uuid().optional().nullable(), reason: z.string().trim().min(5).max(500) }).parse(req.body); const current = await prisma.attendance.findUnique({ where: { id: String(req.params.id) } }); if (!current) throw new AppError(404, "Attendance record not found."); const checkInAt = new Date(body.checkInAt), checkOutAt = body.checkOutAt ? new Date(body.checkOutAt) : null; if (checkOutAt && checkOutAt <= checkInAt) throw new AppError(422, "Check-out must be after check-in."); const status = current.status === AttendanceStatus.OPEN && !checkOutAt ? AttendanceStatus.OPEN : AttendanceStatus.CORRECTED; const updated = await prisma.attendance.update({ where: { id: current.id }, data: { originalCheckInAt: current.originalCheckInAt ?? current.checkInAt, originalCheckOutAt: current.originalCheckOutAt ?? current.checkOutAt, checkInAt, checkOutAt, shiftId: body.shiftId, status, correctionReason: body.reason } }); await audit(req, "ATTENDANCE_CORRECTED", "Attendance", current.id, { reason: body.reason }); ok(res, updated); }));
