import bcrypt from "bcryptjs";
import { PrismaClient, DurationUnit, PlanType, NotificationType } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const plans = [
    { name: "Study Monthly", type: PlanType.STUDY_MONTHLY, price: "1200.00", duration: 1, durationUnit: DurationUnit.MONTH, studyAccess: true, bookAccess: false, maxBooks: 0, loanDays: 0, renewalLimit: 0 },
    { name: "Class Membership", type: PlanType.BOOK, price: "600.00", duration: 6, durationUnit: DurationUnit.MONTH, studyAccess: false, bookAccess: true, maxBooks: 0, loanDays: 0, renewalLimit: 0 },
    { name: "Study + Class", type: PlanType.COMBINED, price: "1500.00", duration: 1, durationUnit: DurationUnit.MONTH, studyAccess: true, bookAccess: true, maxBooks: 0, loanDays: 0, renewalLimit: 0 }
  ];
  for (const plan of plans) await prisma.membershipPlan.upsert({ where: { name: plan.name }, update: {}, create: plan });
  await prisma.shift.upsert({ where: { name: "Permanent" }, update: { active: true, fullDay: true }, create: { name: "Permanent", startMinutes: 0, endMinutes: 0, fullDay: true, active: true } });
  if (await prisma.studyRoom.count({ where: { active: true } }) === 0) await prisma.studyRoom.create({ data: { name: "Main Study Space", description: "Primary study seating area" } });
  for (const name of ["Fiction", "Non-fiction", "Competitive Exams", "Reference", "Marathi Literature"]) await prisma.bookCategory.upsert({ where: { name }, update: {}, create: { name } });
  const settings = { library: { name: "Swapnapurti Library", timezone: "Asia/Kolkata", currency: "INR" }, books: { finePerDay: "5.00", reservationDays: 2 }, payments: { receiptPrefix: "SWP-RCPT" }, notifications: { seatExpiryDays: 3 } };
  for (const [key, value] of Object.entries(settings)) await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  if (process.env.ADMIN_SETUP_EMAIL && process.env.ADMIN_SETUP_PASSWORD && await prisma.admin.count() === 0) await prisma.admin.create({ data: { email: process.env.ADMIN_SETUP_EMAIL.toLowerCase(), name: "Library Administrator", passwordHash: await bcrypt.hash(process.env.ADMIN_SETUP_PASSWORD, 12) } });
  for (const type of Object.values(NotificationType)) await prisma.notificationTemplate.upsert({ where: { type }, update: {}, create: { type, subject: type.replaceAll("_", " "), body: "{{memberName}} — please review this library reminder." } });
}
main().finally(() => prisma.$disconnect());
