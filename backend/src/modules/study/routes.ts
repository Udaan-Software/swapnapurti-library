import { AllocationStatus, AttendanceStatus, SeatStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError, asyncHandler, ok } from "../../utils/http.js";
import { audit } from "../../services/audit.js";
import { periodsOverlap, shiftsOverlap } from "../../services/rules.js";

export const roomsRouter = Router(); export const shiftsRouter = Router(); export const allocationsRouter = Router(); export const attendanceRouter = Router();
roomsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.studyRoom.findMany({ include: { seats: { orderBy: { number: "asc" }, include: { allocations: { where: { status: { in: ["ACTIVE", "UPCOMING"] } }, include: { member: true, shift: true } } } } }, orderBy: { name: "asc" } }))));
roomsRouter.post("/", asyncHandler(async (req, res) => { const body = z.object({ name: z.string().min(2), floor: z.string().optional(), description: z.string().optional(), seatCount: z.coerce.number().int().min(0).max(500).default(0), seatPrefix: z.string().max(8).default("S") }).parse(req.body); const room = await prisma.$transaction(async tx => { const created = await tx.studyRoom.create({ data: { name: body.name, floor: body.floor, description: body.description } }); if (body.seatCount) await tx.seat.createMany({ data: Array.from({ length: body.seatCount }, (_, i) => ({ roomId: created.id, number: `${body.seatPrefix}${String(i + 1).padStart(2, "0")}` })) }); return created; }); await audit(req, "ROOM_CREATED", "StudyRoom", room.id, body); ok(res.status(201), room); }));
roomsRouter.post("/:roomId/seats", asyncHandler(async (req, res) => { const data = z.object({ number: z.string().min(1), type: z.string().default("STANDARD") }).parse(req.body); const seat = await prisma.seat.create({ data: { roomId: String(req.params.roomId), ...data } }); await audit(req, "SEAT_CREATED", "Seat", seat.id); ok(res.status(201), seat); }));
roomsRouter.patch("/seats/:id", asyncHandler(async (req, res) => { const data = z.object({ status: z.nativeEnum(SeatStatus).optional(), notes: z.string().optional().nullable(), active: z.boolean().optional() }).parse(req.body); const seat = await prisma.seat.update({ where: { id: String(req.params.id) }, data }); await audit(req, "SEAT_UPDATED", "Seat", seat.id); ok(res, seat); }));
const shiftInput = z.object({ name: z.string().min(2), startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(0).max(1439), fullDay: z.boolean().default(false), crossesMidnight: z.boolean().default(false), active: z.boolean().default(true) });
shiftsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.shift.findMany({ orderBy: { startMinutes: "asc" } }))));
shiftsRouter.post("/", asyncHandler(async (req, res) => { const data = shiftInput.parse(req.body); const shift = await prisma.shift.create({ data }); await audit(req, "SHIFT_CREATED", "Shift", shift.id, data); ok(res.status(201), shift); }));
shiftsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const id = String(req.params.id), data = shiftInput.partial().parse(req.body);
  const current = await prisma.shift.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "Shift not found.");
  const proposed = { ...current, ...data };
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
  const start = new Date(query.startDate), end = new Date(query.endDate);
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  const [shift, access, seats] = await Promise.all([
    prisma.shift.findUnique({ where: { id: query.shiftId } }),
    prisma.subscription.findFirst({ where: { memberId: query.memberId, status: "ACTIVE", startDate: { lte: start }, endDate: { gte: end }, plan: { studyAccess: true } }, include: { plan: { include: { allowedShifts: true } } } }),
    prisma.seat.findMany({
      where: { active: true, status: { notIn: [SeatStatus.MAINTENANCE, SeatStatus.DISABLED] } },
      include: { room: true, allocations: { where: { status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } } },
      orderBy: [{ room: { name: "asc" } }, { number: "asc" }],
    }),
  ]);
  if (!shift?.active) throw new AppError(409, "The selected shift is inactive.");
  if (!access) throw new AppError(409, "Member does not have study access for the full allocation period.", "NO_STUDY_ACCESS");
  if (access.plan.allowedShifts.length && !access.plan.allowedShifts.some(item => item.shiftId === query.shiftId)) throw new AppError(409, "The membership plan does not allow this shift.", "SHIFT_NOT_ALLOWED");
  const available = seats.filter(seat => !seat.allocations.some(allocation => shiftsOverlap(shift, allocation.shift))).map(({ allocations: _allocations, ...seat }) => seat);
  ok(res, available, { count: available.length });
}));
allocationsRouter.get("/", asyncHandler(async (_req, res) => ok(res, await prisma.seatAllocation.findMany({ include: { member: true, seat: { include: { room: true } }, shift: true }, orderBy: { createdAt: "desc" }, take: 200 }))));
allocationsRouter.post("/", asyncHandler(async (req, res) => {
  const body = z.object({ memberId: z.string().uuid(), seatId: z.string().uuid(), shiftId: z.string().uuid(), startDate: z.string().date(), endDate: z.string().date() }).parse(req.body);
  const start = new Date(body.startDate), end = new Date(body.endDate), today = new Date();
  if (end < start) throw new AppError(422, "End date must not be before start date.");
  const allocation = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Seat" WHERE id = ${body.seatId}::uuid FOR UPDATE`;
    const [seat, requestedShift, access] = await Promise.all([
      tx.seat.findUnique({ where: { id: body.seatId } }),
      tx.shift.findUnique({ where: { id: body.shiftId } }),
      tx.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: start }, endDate: { gte: start }, plan: { studyAccess: true } }, include: { plan: { include: { allowedShifts: true } } } })
    ]);
    if (!seat?.active || seat.status === SeatStatus.MAINTENANCE || seat.status === SeatStatus.DISABLED) throw new AppError(409, "This seat is unavailable for allocation.", "SEAT_UNAVAILABLE");
    if (!requestedShift?.active) throw new AppError(409, "The selected shift is inactive.");
    if (!access || access.endDate < end) throw new AppError(409, "Member does not have study access for the full allocation period.", "NO_STUDY_ACCESS");
    if (access.plan.allowedShifts.length && !access.plan.allowedShifts.some(x => x.shiftId === body.shiftId)) throw new AppError(409, "The membership plan does not allow this shift.", "SHIFT_NOT_ALLOWED");
    const existing = await tx.seatAllocation.findMany({ where: { seatId: body.seatId, status: { in: [AllocationStatus.ACTIVE, AllocationStatus.UPCOMING] }, startDate: { lte: end }, endDate: { gte: start } }, include: { shift: true } });
    if (existing.some(x => shiftsOverlap(requestedShift, x.shift))) throw new AppError(409, "This seat is already allocated for an overlapping date and shift.", "SEAT_CONFLICT");
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
  const body = z.object({ memberId: z.string().uuid(), shiftId: z.string().uuid().optional() }).parse(req.body); const now = new Date();
  const access = await prisma.subscription.findFirst({ where: { memberId: body.memberId, status: "ACTIVE", startDate: { lte: now }, endDate: { gte: now }, plan: { studyAccess: true } }, include: { plan: { include: { allowedShifts: true } } } });
  if (!access) throw new AppError(409, "Member does not have active study access.", "NO_STUDY_ACCESS");
  if (access.plan.allowedShifts.length && (!body.shiftId || !access.plan.allowedShifts.some(x => x.shiftId === body.shiftId))) throw new AppError(409, "The membership plan does not allow this shift.", "SHIFT_NOT_ALLOWED");
  const attendance = await prisma.$transaction(async tx => { const open = await tx.attendance.findFirst({ where: { memberId: body.memberId, status: AttendanceStatus.OPEN } }); if (open) throw new AppError(409, "Member is already checked in.", "ALREADY_CHECKED_IN"); return tx.attendance.create({ data: { ...body, checkInAt: now } }); });
  await audit(req, "ATTENDANCE_CHECK_IN", "Attendance", attendance.id); ok(res.status(201), attendance);
}));
attendanceRouter.post("/:id/check-out", asyncHandler(async (req, res) => { const item = await prisma.attendance.findUnique({ where: { id: String(req.params.id) } }); if (!item || item.status !== AttendanceStatus.OPEN) throw new AppError(409, "No open attendance session was found."); const updated = await prisma.attendance.update({ where: { id: item.id }, data: { checkOutAt: new Date(), status: AttendanceStatus.COMPLETED } }); await audit(req, "ATTENDANCE_CHECK_OUT", "Attendance", item.id); ok(res, updated); }));
