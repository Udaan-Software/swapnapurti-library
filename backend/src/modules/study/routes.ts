import { AllocationStatus, AttendanceStatus, Prisma, SeatStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { dateInTimeZone, periodsCoverRange, periodsOverlap, shiftTimingIssue, shiftsOverlap } from "../../services/rules.js";
import { env } from "../../config/env.js";
import { permanentShift, primaryRoom, type StudyDb } from "../../services/studyDefaults.js";

export const roomsRouter = Router(); export const shiftsRouter = Router(); export const allocationsRouter = Router(); export const attendanceRouter = Router();
const allocationStatuses: AllocationStatus[] = [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING];
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
async function requireStudyCoverage(db: StudyDb, memberId: string, start: Date, end: Date) {
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
}
roomsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.studyRoom.findMany({ include: { seats: { orderBy: { number: "asc" }, include: { allocations: { where: { status: { in: ["ACTIVE", "UPCOMING"] } }, include: { member: true, shift: true } } } } }, orderBy: { createdAt: "asc" } }))));
roomsRouter.post("/", asyncHandler(async (req, res) => { const body = z.object({ name: z.string().min(2), floor: z.string().optional(), description: z.string().optional(), seatCount: z.coerce.number().int().min(0).max(500).default(0), seatPrefix: z.string().max(8).default("S") }).parse(req.body); const room = await prisma.$transaction(async tx => { const created = await tx.studyRoom.create({ data: { name: body.name, floor: body.floor, description: body.description } }); if (body.seatCount) await tx.seat.createMany({ data: Array.from({ length: body.seatCount }, (_, i) => ({ roomId: created.id, number: `${body.seatPrefix}${String(i + 1).padStart(2, "0")}` })) }); return created; }); await audit(req, "ROOM_CREATED", "StudyRoom", room.id, body); ok(res.status(201), room); }));
roomsRouter.patch("/:id", asyncHandler(async (req, res) => { const data = z.object({ name: z.string().trim().min(2).optional(), floor: z.string().optional().nullable(), description: z.string().optional().nullable(), active: z.boolean().optional() }).parse(req.body); if (data.active === false) { const allocated = await prisma.seatAllocation.count({ where: { seat: { roomId: String(req.params.id) }, status: { in: allocationStatuses }, endDate: { gte: dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE) } } }); if (allocated) throw new AppError(409, "Release or reassign this room's current and upcoming seats before deactivating it.", "ROOM_HAS_ALLOCATIONS"); } const room = await prisma.studyRoom.update({ where: { id: String(req.params.id) }, data }); await audit(req, "ROOM_UPDATED", "StudyRoom", room.id, { fields: Object.keys(data) }); ok(res, room); }));
roomsRouter.post("/:roomId/seats", asyncHandler(async (req, res) => { const data = z.object({ number: z.string().min(1), type: z.string().default("STANDARD") }).parse(req.body); const room = await primaryRoom(prisma); if (String(req.params.roomId) !== room.id) throw new AppError(409, "Seats can only be added to the configured study space.", "STUDY_SPACE_MISMATCH"); const seat = await prisma.seat.create({ data: { roomId: room.id, ...data } }); await audit(req, "SEAT_CREATED", "Seat", seat.id); ok(res.status(201), seat); }));
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
  const query = z.object({ memberId: z.string().uuid(), shiftId: z.string().uuid().optional(), startDate: z.string().date(), endDate: z.string().date(), allocationId: z.string().uuid().optional() }).parse(req.query);
  const start = asDate(query.startDate), end = asDate(query.endDate), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  const editedAllocation = query.allocationId ? await prisma.seatAllocation.findUnique({ where: { id: query.allocationId } }) : null;
  if (query.allocationId && (!editedAllocation || editedAllocation.memberId !== query.memberId || !allocationStatuses.includes(editedAllocation.status))) throw new AppError(404, "Editable seat allocation not found.", "ALLOCATION_NOT_FOUND");
  if (editedAllocation && (editedAllocation.startDate.getTime() !== start.getTime() || editedAllocation.endDate.getTime() !== end.getTime())) throw new AppError(422, "Seat availability must use the allocation's existing date period.", "ALLOCATION_PERIOD_MISMATCH");
  if (!editedAllocation && start < today) throw new AppError(422, "A new seat allocation cannot start in the past.", "PAST_ALLOCATION");
  const [shift, room] = await Promise.all([permanentShift(prisma), primaryRoom(prisma)]);
  const [seats, memberAllocations] = await Promise.all([
    prisma.seat.findMany({
      where: { roomId: room.id, active: true, status: { notIn: [SeatStatus.MAINTENANCE, SeatStatus.DISABLED] } },
      include: { room: true, allocations: { where: { id: query.allocationId ? { not: query.allocationId } : undefined, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } } },
      orderBy: { number: "asc" },
    }),
    prisma.seatAllocation.findMany({ where: { id: query.allocationId ? { not: query.allocationId } : undefined, memberId: query.memberId, status: { in: allocationStatuses }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true, seat: { include: { room: true } } } }),
  ]);
  await requireStudyCoverage(prisma, query.memberId, start, end);
  const memberConflict = memberAllocations.find(allocation => shiftsOverlap(shift, allocation.shift));
  if (memberConflict) throw new AppError(409, `Member already has Seat ${memberConflict.seat.number} for an overlapping period.`, "MEMBER_ALLOCATION_CONFLICT");
  const available = seats.filter(seat => seat.id !== editedAllocation?.seatId && !seat.allocations.some(allocation => shiftsOverlap(shift, allocation.shift))).map(({ allocations: _allocations, ...seat }) => seat);
  ok(res, available, { count: available.length });
}));
allocationsRouter.get("/seat-map", asyncHandler(async (req, res) => {
  const query = z.object({ shiftId: z.string().uuid().optional(), date: z.string().date() }).parse(req.query);
  const date = asDate(query.date), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (date < today) throw new AppError(422, "The live seat map is available for today and future dates.", "PAST_SEAT_MAP");
  const [shift, room] = await Promise.all([permanentShift(prisma), primaryRoom(prisma)]);
  const rooms = await prisma.studyRoom.findMany({
    where: { id: room.id },
    include: { seats: { orderBy: { number: "asc" }, include: { allocations: { where: { status: { in: allocationStatuses }, startDate: { lte: date }, endDate: { gte: date } }, include: { member: { select: { id: true, publicId: true, fullName: true, mobile: true } }, shift: true } } } } },
  });
  const checkedIn = date.getTime() === today.getTime() ? new Set((await prisma.attendance.findMany({ where: { status: AttendanceStatus.OPEN }, select: { memberId: true } })).map(item => item.memberId)) : new Set<string>();
  const result = rooms.map(currentRoom => ({ ...currentRoom, seats: currentRoom.seats.map(seat => {
    const allocation = seat.allocations.find(item => shiftsOverlap(shift, item.shift));
    const unavailable = !currentRoom.active || !seat.active || seat.status === SeatStatus.DISABLED;
    const displayStatus = unavailable ? "DISABLED" : seat.status === SeatStatus.MAINTENANCE ? "MAINTENANCE" : allocation ? (checkedIn.has(allocation.memberId) ? "OCCUPIED" : "RESERVED") : "AVAILABLE";
    return { id: seat.id, number: seat.number, type: seat.type, notes: seat.notes, active: seat.active, status: seat.status, displayStatus, allocation: allocation ? { id: allocation.id, startDate: allocation.startDate, endDate: allocation.endDate, status: allocation.status, member: allocation.member } : null };
  }) }));
  ok(res, result, { date: query.date });
}));
allocationsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.seatAllocation.findMany({ include: { member: true, seat: { include: { room: true } }, shift: true }, orderBy: { createdAt: "desc" }, take: 200 }))));
allocationsRouter.post("/", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), seatId: z.string().uuid(), shiftId: z.string().uuid().optional(), startDate: z.string().date(), endDate: z.string().date() }).parse(req.body);
  const start = asDate(body.startDate), end = asDate(body.endDate), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  if (start < today) throw new AppError(422, "A new seat allocation cannot start in the past.", "PAST_ALLOCATION");
  const allocation = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ${body.memberId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${body.seatId}::uuid FOR UPDATE`;
    const [seat, requestedShift, room] = await Promise.all([
      tx.seat.findUnique({ where: { id: body.seatId } }),
      permanentShift(tx),
      primaryRoom(tx),
    ]);
    if (!seat?.active || seat.roomId !== room.id || seat.status === SeatStatus.MAINTENANCE || seat.status === SeatStatus.DISABLED) throw new AppError(409, "This seat is unavailable for allocation.", "SEAT_UNAVAILABLE");
    await requireStudyCoverage(tx, body.memberId, start, end);
    const existing = await tx.seatAllocation.findMany({ where: { seatId: body.seatId, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } });
    if (existing.some(x => shiftsOverlap(requestedShift, x.shift))) throw new AppError(409, "This seat is already allocated for an overlapping date period.", "SEAT_CONFLICT");
    const memberAllocations = await tx.seatAllocation.findMany({ where: { memberId: body.memberId, status: { in: allocationStatuses }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } });
    if (memberAllocations.some(item => shiftsOverlap(requestedShift, item.shift))) throw new AppError(409, "This member already has a seat for an overlapping date period.", "MEMBER_ALLOCATION_CONFLICT");
    const created = await tx.seatAllocation.create({ data: { memberId: body.memberId, seatId: body.seatId, shiftId: requestedShift.id, startDate: start, endDate: end, status: start > today ? AllocationStatus.UPCOMING : AllocationStatus.ACTIVE } });
    if (start <= today && end >= today) await tx.seat.update({ where: { id: seat.id }, data: { status: SeatStatus.ALLOCATED } });
    return created;
  });
  await audit(req, "SEAT_ALLOCATED", "SeatAllocation", allocation.id, { memberId: body.memberId, seatId: body.seatId, startDate: body.startDate, endDate: body.endDate }); ok(res.status(201), allocation);
}));
allocationsRouter.patch("/:id/reassign", asyncHandler(async (req, res) => {
  const id = String(req.params.id), body = z.object({ seatId: z.string().uuid() }).parse(req.body), today = dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SeatAllocation" WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.seatAllocation.findUnique({ where: { id }, include: { shift: true } });
    if (!current || !allocationStatuses.includes(current.status)) throw new AppError(409, "Only an active or upcoming seat allocation can be changed.", "ALLOCATION_NOT_EDITABLE");
    if (current.seatId === body.seatId) throw new AppError(422, "Select a different available seat.", "SEAT_UNCHANGED");
    await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${body.seatId}::uuid FOR UPDATE`;
    const [seat, shift, room] = await Promise.all([tx.seat.findUnique({ where: { id: body.seatId } }), permanentShift(tx), primaryRoom(tx)]);
    if (!seat?.active || seat.roomId !== room.id || seat.status === SeatStatus.MAINTENANCE || seat.status === SeatStatus.DISABLED) throw new AppError(409, "The selected seat is no longer available.", "SEAT_UNAVAILABLE");
    const conflicts = await tx.seatAllocation.findMany({ where: { id: { not: current.id }, seatId: body.seatId, status: { in: allocationStatuses }, startDate: { lte: current.endDate }, endDate: { gte: current.startDate } }, include: { shift: true } });
    if (conflicts.some(item => shiftsOverlap(shift, item.shift))) throw new AppError(409, "The selected seat is no longer available for this allocation period.", "SEAT_CONFLICT");
    const updated = await tx.seatAllocation.update({ where: { id }, data: { seatId: body.seatId } });
    const oldSeatStillAllocated = await tx.seatAllocation.count({ where: { id: { not: current.id }, seatId: current.seatId, status: AllocationStatus.ACTIVE, startDate: { lte: today }, endDate: { gte: today } } });
    if (!oldSeatStillAllocated) await tx.seat.updateMany({ where: { id: current.seatId, status: SeatStatus.ALLOCATED }, data: { status: SeatStatus.AVAILABLE } });
    if (current.startDate <= today && current.endDate >= today) await tx.seat.update({ where: { id: body.seatId }, data: { status: SeatStatus.ALLOCATED } });
    return { updated, previousSeatId: current.seatId };
  });
  await audit(req, "SEAT_REASSIGNED", "SeatAllocation", result.updated.id, { previousSeatId: result.previousSeatId, seatId: body.seatId });
  ok(res, result.updated);
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
  const body = z.object({ memberId: z.string().uuid() }).parse(req.body); const now = new Date(), today = dateInTimeZone(now, env.LIBRARY_TIMEZONE);
  const [access, shift] = await Promise.all([
    prisma.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: today }, endDate: { gte: today }, plan: { studyAccess: true } } }),
    permanentShift(prisma),
  ]);
  if (!access) throw new AppError(409, "Member does not have active study access.", "NO_STUDY_ACCESS");
  const attendance = await prisma.$transaction(async tx => {
    const open = await tx.attendance.findFirst({ where: { memberId: body.memberId, status: AttendanceStatus.OPEN } });
    if (open) throw new AppError(409, "Member is already checked in.", "ALREADY_CHECKED_IN");
    return tx.attendance.create({ data: { memberId: body.memberId, shiftId: shift.id, checkInAt: now } });
  });
  await audit(req, "ATTENDANCE_CHECK_IN", "Attendance", attendance.id); ok(res.status(201), attendance);
}));
attendanceRouter.post("/:id/check-out", asyncHandler(async (req, res) => { const item = await prisma.attendance.findUnique({ where: { id: String(req.params.id) } }); if (!item || item.status !== AttendanceStatus.OPEN) throw new AppError(409, "No open attendance session was found."); const updated = await prisma.attendance.update({ where: { id: item.id }, data: { checkOutAt: new Date(), status: AttendanceStatus.COMPLETED } }); await audit(req, "ATTENDANCE_CHECK_OUT", "Attendance", item.id); ok(res, updated); }));
attendanceRouter.patch("/:id/correct", asyncHandler(async (req, res) => { const body = z.object({ checkInAt: z.string().datetime(), checkOutAt: z.string().datetime().optional().nullable(), shiftId: z.string().uuid().optional().nullable(), reason: z.string().trim().min(5).max(500) }).parse(req.body); const current = await prisma.attendance.findUnique({ where: { id: String(req.params.id) } }); if (!current) throw new AppError(404, "Attendance record not found."); const checkInAt = new Date(body.checkInAt), checkOutAt = body.checkOutAt ? new Date(body.checkOutAt) : null; if (checkOutAt && checkOutAt <= checkInAt) throw new AppError(422, "Check-out must be after check-in."); const status = current.status === AttendanceStatus.OPEN && !checkOutAt ? AttendanceStatus.OPEN : AttendanceStatus.CORRECTED; const updated = await prisma.attendance.update({ where: { id: current.id }, data: { originalCheckInAt: current.originalCheckInAt ?? current.checkInAt, originalCheckOutAt: current.originalCheckOutAt ?? current.checkOutAt, checkInAt, checkOutAt, shiftId: body.shiftId, status, correctionReason: body.reason } }); await audit(req, "ATTENDANCE_CORRECTED", "Attendance", current.id, { reason: body.reason }); ok(res, updated); }));
