import bcrypt from "bcryptjs";
import { PrismaClient, DurationUnit, PlanType, NotificationType } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const plans = [
    { name: "Study Monthly", type: PlanType.STUDY_MONTHLY, price: "1200.00", duration: 1, durationUnit: DurationUnit.MONTH, studyAccess: true, bookAccess: false, maxBooks: 0, loanDays: 0, renewalLimit: 0 },
    { name: "Book Membership", type: PlanType.BOOK, price: "600.00", duration: 6, durationUnit: DurationUnit.MONTH, studyAccess: false, bookAccess: true, maxBooks: 2, loanDays: 14, renewalLimit: 1 },
    { name: "Study + Books", type: PlanType.COMBINED, price: "1500.00", duration: 1, durationUnit: DurationUnit.MONTH, studyAccess: true, bookAccess: true, maxBooks: 2, loanDays: 14, renewalLimit: 1 }
  ];
  for (const plan of plans) await prisma.membershipPlan.upsert({ where: { name: plan.name }, update: {}, create: plan });
  for (const shift of [{ name: "Morning", startMinutes: 360, endMinutes: 720 }, { name: "Afternoon", startMinutes: 720, endMinutes: 1080 }, { name: "Evening", startMinutes: 1080, endMinutes: 1380 }, { name: "Full Day", startMinutes: 360, endMinutes: 1380, fullDay: true }]) await prisma.shift.upsert({ where: { name: shift.name }, update: {}, create: shift });
  for (const name of ["Fiction", "Non-fiction", "Competitive Exams", "Reference", "Marathi Literature"]) await prisma.bookCategory.upsert({ where: { name }, update: {}, create: { name } });
  const settings = { library: { name: "Swapnapurti Library", timezone: "Asia/Kolkata", currency: "INR" }, books: { finePerDay: "5.00", reservationDays: 2 }, payments: { receiptPrefix: "SWP-RCPT" }, notifications: { seatExpiryDays: 3 } };
  for (const [key, value] of Object.entries(settings)) await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  if (process.env.ADMIN_SETUP_EMAIL && process.env.ADMIN_SETUP_PASSWORD && await prisma.admin.count() === 0) await prisma.admin.create({ data: { email: process.env.ADMIN_SETUP_EMAIL.toLowerCase(), name: "Library Administrator", passwordHash: await bcrypt.hash(process.env.ADMIN_SETUP_PASSWORD, 12) } });
  for (const type of Object.values(NotificationType)) await prisma.notificationTemplate.upsert({ where: { type }, update: {}, create: { type, subject: type.replaceAll("_", " "), body: "{{memberName}} — please review this library reminder." } });
}
main().finally(() => prisma.$disconnect());
