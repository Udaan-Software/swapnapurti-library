import { MemberType, Prisma } from "@prisma/client";
import { dateInTimeZone, subscriptionEndDate } from "./rules.js";
import { env } from "../config/env.js";
import { differenceInCalendarDays } from "date-fns";
import { AppError } from "../utils/http.js";

export type PlanWithShifts = Prisma.MembershipPlanGetPayload<{ include: { allowedShifts: true } }>;

export function memberTypeForPlan(plan: Pick<PlanWithShifts, "studyAccess" | "bookAccess">) {
  if (plan.studyAccess && plan.bookAccess) return MemberType.BOTH;
  return plan.studyAccess ? MemberType.STUDY : MemberType.BOOK;
}

export function membershipQuote(plan: Pick<PlanWithShifts, "price" | "duration" | "durationUnit">, startDate: Date, requestedEndDate?: Date, discount = 0) {
  const defaultEndDate = subscriptionEndDate(startDate, plan.duration, plan.durationUnit);
  const endDate = requestedEndDate ?? defaultEndDate;
  if (endDate < defaultEndDate) throw new AppError(422, "Membership end date cannot be earlier than the plan's default end date.", "MEMBERSHIP_END_TOO_EARLY");
  const standardDays = differenceInCalendarDays(defaultEndDate, startDate) + 1;
  const assignedDays = differenceInCalendarDays(endDate, startDate) + 1;
  const originalFee = new Prisma.Decimal(plan.price).mul(assignedDays).div(standardDays).toDecimalPlaces(2);
  const discountAmount = new Prisma.Decimal(discount).toDecimalPlaces(2);
  if (discountAmount.greaterThan(originalFee)) throw new AppError(422, "Discount cannot exceed the calculated membership fee.", "INVALID_DISCOUNT");
  const finalFee = originalFee.sub(discountAmount).toDecimalPlaces(2);
  return { startDate, defaultEndDate, endDate, standardDays, assignedDays, originalFee, discount: discountAmount, finalFee };
}

export async function createBilledSubscription(tx: Prisma.TransactionClient, input: { memberId: string; plan: PlanWithShifts; startDate: Date; endDate?: Date; discount: number; renewalReference?: string }) {
  const quote = membershipQuote(input.plan, input.startDate, input.endDate, input.discount);
  const subscription = await tx.subscription.create({
    data: {
      memberId: input.memberId,
      planId: input.plan.id,
      startDate: input.startDate,
      endDate: quote.endDate,
      originalFee: quote.originalFee,
      discount: quote.discount,
      finalFee: quote.finalFee,
      renewalReference: input.renewalReference,
      paymentStatus: quote.finalFee.isZero() ? "PAID" : "UNPAID",
      planSnapshot: { name: input.plan.name, type: input.plan.type, price: input.plan.price.toString(), duration: input.plan.duration, durationUnit: input.plan.durationUnit, studyAccess: input.plan.studyAccess, bookAccess: input.plan.bookAccess, maxBooks: input.plan.maxBooks, loanDays: input.plan.loanDays, renewalLimit: input.plan.renewalLimit, shiftIds: input.plan.allowedShifts.map(item => item.shiftId), defaultEndDate: quote.defaultEndDate.toISOString().slice(0, 10), assignedEndDate: quote.endDate.toISOString().slice(0, 10), standardDays: quote.standardDays, assignedDays: quote.assignedDays, pricing: "DAILY_PRORATED" },
    },
  });
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('invoice_number_seq') AS value`;
  const invoice = await tx.invoice.create({
    data: {
      invoiceNo: `SWP-INV-${String(rows[0]!.value).padStart(6, "0")}`,
      memberId: input.memberId,
      subscriptionId: subscription.id,
      total: quote.finalFee,
      paid: "0.00",
      status: quote.finalFee.isZero() ? "PAID" : "ISSUED",
      dueDate: input.startDate,
      items: { create: { type: "SUBSCRIPTION", description: `Membership fee — ${input.plan.name} · ${quote.assignedDays} days`, quantity: 1, unitAmount: quote.finalFee, total: quote.finalFee } },
    },
    include: { items: true },
  });
  if (input.startDate <= dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE)) await tx.member.update({ where: { id: input.memberId }, data: { type: memberTypeForPlan(input.plan) } });
  return { subscription, invoice };
}
