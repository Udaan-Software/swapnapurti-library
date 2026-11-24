import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { syncSeatAllocationNotifications } from "../../src/services/reminders.js";

describe.sequential("administrator critical workflows", () => {
  const agent = request.agent(app);
  let csrf = "";
  let planId = "";
  let shiftId = "";
  let seatId = "";
  let memberOne = "";
  let memberTwo = "";
  let bookId = "";
  let copyId = "";
  let loanId = "";
  let allocationId = "";

  beforeAll(async () => {
    await prisma.admin.create({ data: { name: "Integration Administrator", email: "integration@swapnapurti.test", passwordHash: await bcrypt.hash("Integration#2026!", 4) } });
    const login = await agent.post("/api/v1/auth/login").send({ email: "integration@swapnapurti.test", password: "Integration#2026!" });
    expect(login.status).toBe(200);
    csrf = login.body.data.csrfToken;
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const post = (url: string, body?: object) => agent.post(url).set("x-csrf-token", csrf).send(body);
  const patch = (url: string, body?: object) => agent.patch(url).set("x-csrf-token", csrf).send(body);

  it("creates a plan, members, subscriptions, room, seat and shift", async () => {
    const plan = await post("/api/v1/membership-plans", { name: "Integration Combined", type: "COMBINED", price: 1500, duration: 1, durationUnit: "MONTH", studyAccess: true, bookAccess: true, maxBooks: 1, loanDays: 14, renewalLimit: 1 });
    expect(plan.status).toBe(201); planId = plan.body.data.id;
    const shift = await post("/api/v1/shifts", { name: "Integration Morning", startMinutes: 360, endMinutes: 720 });
    expect(shift.status).toBe(201); shiftId = shift.body.data.id;
    const editedShift = await patch(`/api/v1/shifts/${shiftId}`, { name: "Integration Morning Updated", startMinutes: 360, endMinutes: 720, active: true });
    expect(editedShift.status).toBe(200); expect(editedShift.body.data.name).toBe("Integration Morning Updated");
    const room = await post("/api/v1/study-rooms", { name: "Integration Room", floor: "1", seatCount: 1, seatPrefix: "I" });
    expect(room.status).toBe(201);
    const rooms = await agent.get("/api/v1/study-rooms"); seatId = rooms.body.data[0].seats[0].id;
    for (const [name, mobile] of [["Integration One", "9000000001"], ["Integration Two", "9000000002"]]) {
      const member = await post("/api/v1/members", { fullName: name, mobile, type: "BOTH", status: "ACTIVE" });
      expect(member.status).toBe(201); if (!memberOne) memberOne = member.body.data.id; else memberTwo = member.body.data.id;
    }
    for (const memberId of [memberOne, memberTwo]) expect((await post("/api/v1/subscriptions", { memberId, planId, startDate: new Date().toISOString().slice(0, 10), discount: 0 })).status).toBe(201);
  });

  it("prevents seat conflicts and duplicate attendance sessions", async () => {
    const end = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10); const start = new Date().toISOString().slice(0, 10);
    const beforeAllocation = await agent.get("/api/v1/seat-allocations/available-seats").query({ memberId: memberOne, shiftId, startDate: start, endDate: end });
    expect(beforeAllocation.status).toBe(200); expect(beforeAllocation.body.data).toHaveLength(1);
    const allocated = await post("/api/v1/seat-allocations", { memberId: memberOne, seatId, shiftId, startDate: start, endDate: end }); expect(allocated.status).toBe(201); allocationId = allocated.body.data.id;
    const afterAllocation = await agent.get("/api/v1/seat-allocations/available-seats").query({ memberId: memberTwo, shiftId, startDate: start, endDate: end });
    expect(afterAllocation.status).toBe(200); expect(afterAllocation.body.data).toHaveLength(0);
    expect((await post("/api/v1/seat-allocations", { memberId: memberTwo, seatId, shiftId, startDate: start, endDate: end })).status).toBe(409);
    const checkIn = await post("/api/v1/attendance/check-in", { memberId: memberOne, shiftId }); expect(checkIn.status).toBe(201);
    expect((await post("/api/v1/attendance/check-in", { memberId: memberOne, shiftId })).status).toBe(409);
    expect((await post(`/api/v1/attendance/${checkIn.body.data.id}/check-out`)).status).toBe(200);
  });

  it("creates one seat-expiry reminder and closes an expired allocation", async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0); const tomorrow = new Date(today.getTime() + 86400000);
    await prisma.seatAllocation.update({ where: { id: allocationId }, data: { endDate: tomorrow } });
    await syncSeatAllocationNotifications(today); await syncSeatAllocationNotifications(today);
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `seat-expiring:${allocationId}:` } } })).toBe(1);
    await syncSeatAllocationNotifications(new Date(today.getTime() + 2 * 86400000));
    expect((await prisma.seatAllocation.findUniqueOrThrow({ where: { id: allocationId } })).status).toBe("EXPIRED");
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `seat-expired:${allocationId}:` } } })).toBe(1);
  });

  it("protects copy-level circulation and supports reservation and return", async () => {
    const book = await post("/api/v1/books", { title: "Integration Book", authors: "Test Author", language: "English", copies: 1 }); expect(book.status).toBe(201); bookId = book.body.data.id;
    const books = await agent.get("/api/v1/books"); copyId = books.body.data.find((b: { id: string }) => b.id === bookId).copies[0].id;
    const issue = await post("/api/v1/loans/issue", { memberId: memberOne, copyId }); expect(issue.status).toBe(201); loanId = issue.body.data.id;
    expect((await post("/api/v1/loans/issue", { memberId: memberTwo, copyId })).status).toBe(409);
    expect((await post("/api/v1/reservations", { memberId: memberTwo, bookId })).status).toBe(201);
    const returned = await post(`/api/v1/loans/${loanId}/return`, { condition: "GOOD" }); expect(returned.status).toBe(200); expect(returned.body.data.reservation.status).toBe("READY");
    const refreshed = await agent.get("/api/v1/books"); expect(refreshed.body.data.find((b: { id: string }) => b.id === bookId).copies[0].status).toBe("RESERVED");
  });

  it("records an invoice, idempotent payment and expense", async () => {
    const invoice = await post("/api/v1/payments/invoices", { memberId: memberOne, items: [{ type: "SUBSCRIPTION", description: "Integration fee", quantity: 1, unitAmount: 1500 }] }); expect(invoice.status).toBe(201);
    const beforePayment = await agent.get(`/api/v1/members/${memberOne}`); expect(beforePayment.body.data.financialSummary.pendingAmount).toBe("1500.00");
    const payment = { memberId: memberOne, invoiceId: invoice.body.data.id, amount: 1500, method: "CASH", idempotencyKey: "integration-payment-1" };
    const firstPayment = await post("/api/v1/payments", payment); expect(firstPayment.status).toBe(201);
    const repeatedPayment = await post("/api/v1/payments", payment); expect(repeatedPayment.status).toBe(200); expect(repeatedPayment.body.data.id).toBe(firstPayment.body.data.id);
    const receipt = await agent.get(`/api/v1/payments/${firstPayment.body.data.id}/receipt`); expect(receipt.status).toBe(200); expect(receipt.body.data.receiptNo).toBe(firstPayment.body.data.receiptNo); expect(receipt.body.data.member.publicId).toBeTruthy(); expect(receipt.body.data.netAmount).toBe(1500);
    const afterPayment = await agent.get(`/api/v1/members/${memberOne}`); expect(afterPayment.body.data.financialSummary.paidAmount).toBe("1500.00"); expect(afterPayment.body.data.financialSummary.pendingAmount).toBe("0.00");
    expect((await post("/api/v1/expenses", { category: "Maintenance", description: "Integration expense", amount: 100, expenseDate: new Date().toISOString().slice(0, 10), method: "CASH" })).status).toBe(201);
    const dashboard = await agent.get("/api/v1/dashboard"); expect(dashboard.status).toBe(200); expect(dashboard.body.data.stats.members).toBe(2);
  });
});
