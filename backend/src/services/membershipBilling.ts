import { MemberType, Prisma } from "@prisma/client";
import { dateInTimeZone, subscriptionEndDate } from "./rules.js";
import { env } from "../config/env.js";

export type PlanWithShifts = Prisma.MembershipPlanGetPayload<{ include: { allowedShifts: true } }>;

export function memberTypeForPlan(plan: Pick<PlanWithShifts, "studyAccess" | "bookAccess">) {
  if (plan.studyAccess && plan.bookAccess) return MemberType.BOTH;
  return plan.studyAccess ? MemberType.STUDY : MemberType.BOOK;
}

export async function createBilledSubscription(tx: Prisma.TransactionClient, input: { memberId: string; plan: PlanWithShifts; startDate: Date; discount: number; renewalReference?: string }) {
  const finalFee = Math.max(0, Number(input.plan.price) - input.discount);
  const subscription = await tx.subscription.create({
    data: {
      memberId: input.memberId,
      planId: input.plan.id,
      startDate: input.startDate,
      endDate: subscriptionEndDate(input.startDate, input.plan.duration, input.plan.durationUnit),
      originalFee: input.plan.price,
      discount: input.discount.toFixed(2),
      finalFee: finalFee.toFixed(2),
      renewalReference: input.renewalReference,
      paymentStatus: finalFee === 0 ? "PAID" : "UNPAID",
      planSnapshot: { name: input.plan.name, type: input.plan.type, price: input.plan.price.toString(), duration: input.plan.duration, durationUnit: input.plan.durationUnit, studyAccess: input.plan.studyAccess, bookAccess: input.plan.bookAccess, maxBooks: input.plan.maxBooks, loanDays: input.plan.loanDays, renewalLimit: input.plan.renewalLimit, shiftIds: input.plan.allowedShifts.map(item => item.shiftId) },
    },
  });
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('invoice_number_seq') AS value`;
  const invoice = await tx.invoice.create({
    data: {
      invoiceNo: `SWP-INV-${String(rows[0]!.value).padStart(6, "0")}`,
      memberId: input.memberId,
      subscriptionId: subscription.id,
      total: finalFee.toFixed(2),
      paid: "0.00",
      status: finalFee === 0 ? "PAID" : "ISSUED",
      dueDate: input.startDate,
      items: { create: { type: "SUBSCRIPTION", description: `Membership fee — ${input.plan.name}`, quantity: 1, unitAmount: finalFee.toFixed(2), total: finalFee.toFixed(2) } },
    },
    include: { items: true },
  });
  if (input.startDate <= dateInTimeZone(new Date(), env.LIBRARY_TIMEZONE)) await tx.member.update({ where: { id: input.memberId }, data: { type: memberTypeForPlan(input.plan) } });
  return { subscription, invoice };
}
