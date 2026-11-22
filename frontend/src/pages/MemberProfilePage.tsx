import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  CalendarCheck,
  CreditCard,
  MapPin,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, json } from "../lib/api";
import { Button, Card, Empty, Modal } from "../components/ui";
import { badge, money } from "./ResourcePage";

type MemberDetail = {
  id: string;
  publicId: string;
  fullName: string;
  mobile: string;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  type: string;
  status: string;
  registrationDate: string;
  notes?: string | null;
  subscriptions: any[];
  allocations: any[];
  attendances: any[];
  loans: any[];
  payments: any[];
  invoices: any[];
  fines: any[];
  financialSummary: {
    paidAmount: string;
    pendingAmount: string;
    unpaidFines: string;
  };
};
type MembershipPlan = {
  id: string;
  name: string;
  price: string;
  studyAccess: boolean;
  bookAccess: boolean;
  active: boolean;
};
const tabs = [
  "Overview",
  "Memberships",
  "Seat Allocation",
  "Attendance",
  "Borrowed Books",
  "Payments",
  "Fines",
  "History",
] as const;
function libraryDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function MemberProfilePage() {
  const { id } = useParams();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [editOpen, setEditOpen] = useState(false);
  const qc = useQueryClient();
  const {
    data: member,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["member", id],
    queryFn: () => api<MemberDetail>(`/members/${id}`),
    enabled: !!id,
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["/membership-plans"],
    queryFn: () => api<MembershipPlan[]>("/membership-plans"),
  });
  const update = useMutation({
    mutationFn: (form: FormData) =>
      api<MemberDetail>(
        `/members/${id}`,
        json("PATCH", {
          fullName: form.get("fullName"),
          mobile: form.get("mobile"),
          email: form.get("email"),
          dateOfBirth: form.get("dateOfBirth") || null,
          gender: form.get("gender") || null,
          address: form.get("address") || null,
          emergencyContact: form.get("emergencyContact") || null,
          status: form.get("status"),
          notes: form.get("notes") || null,
          membershipPlanId: form.get("membershipPlanId") || undefined,
          membershipDiscount: form.get("membershipDiscount") || 0,
        }),
      ),
    onSuccess: async () => {
      toast.success("Member information updated");
      setEditOpen(false);
      await qc.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  if (isLoading)
    return (
      <div className="py-20 text-center text-[var(--muted)]">
        Loading member profile…
      </div>
    );
  if (error || !member)
    return (
      <Empty
        title="Member not found"
        message={error?.message ?? "The requested member does not exist."}
      />
    );
  const currentMembership = member.subscriptions.find(
    (subscription) => subscription.status === "ACTIVE",
  );
  return (
    <>
      <Link
        to="/members"
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-indigo-600"
      >
        <ArrowLeft size={16} /> Back to members
      </Link>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 p-6 text-white md:p-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="grid h-20 w-20 place-items-center rounded-3xl bg-white/15 backdrop-blur">
              <UserRound size={36} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-black md:text-3xl">
                  {member.fullName}
                </h1>
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                  {member.status}
                </span>
              </div>
              <p className="mt-1 text-indigo-100">
                {member.publicId} · {member.type.replaceAll("_", " ")}
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-indigo-100">
                <span className="flex items-center gap-1.5">
                  <Phone size={15} />
                  {member.mobile}
                </span>
                {member.address && (
                  <span className="flex items-center gap-1.5">
                    <MapPin size={15} />
                    {member.address}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="btn bg-white text-indigo-700 shadow-lg hover:bg-indigo-50"
            >
              <Pencil size={16} />
              Edit member
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border-b border-[var(--border)]">
          <div className="flex min-w-max px-3">
            {tabs.map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === item ? "border-indigo-600 text-indigo-600" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5 md:p-7">
          {tab === "Overview" && <Overview member={member} />}{" "}
          {tab === "Memberships" && (
            <Memberships items={member.subscriptions} />
          )}{" "}
          {tab === "Seat Allocation" && (
            <Allocations items={member.allocations} />
          )}{" "}
          {tab === "Attendance" && <Attendance items={member.attendances} />}{" "}
          {tab === "Borrowed Books" && <Loans items={member.loans} />}{" "}
          {tab === "Payments" && <Payments items={member.payments} />}{" "}
          {tab === "Fines" && <Fines items={member.fines} />}{" "}
          {tab === "History" && <History member={member} />}
        </div>
      </Card>
      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${member.publicId}`}
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(new FormData(event.currentTarget));
          }}
        >
          <label className="text-sm font-semibold sm:col-span-2">
            Full name
            <input
              name="fullName"
              className="input mt-2"
              defaultValue={member.fullName}
              minLength={2}
              required
            />
          </label>
          <label className="text-sm font-semibold">
            Mobile number
            <input
              name="mobile"
              className="input mt-2"
              defaultValue={member.mobile}
              pattern="[0-9+ -]{8,16}"
              required
            />
          </label>
          <label className="text-sm font-semibold">
            Email
            <input
              name="email"
              type="email"
              className="input mt-2"
              defaultValue={member.email ?? ""}
            />
          </label>
          <label className="text-sm font-semibold">
            Date of birth
            <input
              name="dateOfBirth"
              type="date"
              className="input mt-2"
              defaultValue={member.dateOfBirth?.slice(0, 10) ?? ""}
            />
          </label>
          <label className="text-sm font-semibold">
            Gender
            <input
              name="gender"
              className="input mt-2"
              defaultValue={member.gender ?? ""}
            />
          </label>
          <label className="text-sm font-semibold">
            Emergency contact
            <input
              name="emergencyContact"
              className="input mt-2"
              defaultValue={member.emergencyContact ?? ""}
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Membership plan
            <select
              name="membershipPlanId"
              className="input mt-2"
              defaultValue={currentMembership?.planId ?? ""}
            >
              <option value="" disabled>
                Select the plan that controls access and fees
              </option>
              {plans
                .filter(
                  (plan) => plan.active || plan.id === currentMembership?.planId,
                )
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {money(plan.price)} ·{" "}
                    {plan.studyAccess && plan.bookAccess
                      ? "Study + Book"
                      : plan.studyAccess
                        ? "Study"
                        : "Book"}
                  </option>
                ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
              Changing the plan updates member type, access and the pending fee
              invoice together. Paid plans must be refunded first.
            </span>
          </label>
          <label className="text-sm font-semibold">
            Status
            <select
              name="status"
              className="input mt-2"
              defaultValue={member.status}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            New-plan discount
            <input
              name="membershipDiscount"
              className="input mt-2"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Address
            <textarea
              name="address"
              className="input mt-2"
              rows={2}
              defaultValue={member.address ?? ""}
            />
          </label>
          <label className="text-sm font-semibold sm:col-span-2">
            Administrative notes
            <textarea
              name="notes"
              className="input mt-2"
              rows={3}
              defaultValue={member.notes ?? ""}
            />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
function Overview({ member }: { member: MemberDetail }) {
  const today = libraryDateKey();
  const active = member.subscriptions.find(
    (x) =>
      x.status === "ACTIVE" &&
      x.startDate.slice(0, 10) <= today &&
      x.endDate.slice(0, 10) >= today,
  );
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Summary
          icon={<CalendarCheck />}
          label="Current membership"
          value={active?.plan?.name ?? "No active plan"}
        />
        <Summary
          icon={<BookOpen />}
          label="Active book loans"
          value={String(
            member.loans.filter((x) => x.status === "ACTIVE").length,
          )}
        />
        <Summary
          icon={<CreditCard />}
          label="Paid amount"
          value={money(member.financialSummary.paidAmount)}
        />
        <Summary
          icon={<CreditCard />}
          label="Pending invoices"
          value={money(member.financialSummary.pendingAmount)}
        />
        <Summary
          icon={<CreditCard />}
          label="Unpaid fines"
          value={money(member.financialSummary.unpaidFines)}
        />
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--border)] p-5">
        <h3 className="font-bold">Contact and notes</h3>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Email</dt>
            <dd className="mt-1 font-medium">
              {member.email || "Not provided"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Registered</dt>
            <dd className="mt-1 font-medium">
              {new Date(member.registrationDate).toLocaleDateString("en-IN")}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Administrative notes</dt>
            <dd className="mt-1 font-medium">
              {member.notes || "No notes recorded."}
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}
function Summary({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] p-5">
      <div className="text-indigo-600">{icon}</div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
function List({
  items,
  render,
  empty,
}: {
  items: any[];
  render: (x: any) => React.ReactNode;
  empty: string;
}) {
  return items.length ? (
    <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
      {items.map((x, i) => (
        <div key={x.id ?? i} className="p-4">
          {render(x)}
        </div>
      ))}
    </div>
  ) : (
    <Empty title={empty} />
  );
}
function Memberships({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No memberships recorded"
      render={(x) => (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <b>{x.plan.name}</b>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {new Date(x.startDate).toLocaleDateString("en-IN")} —{" "}
              {new Date(x.endDate).toLocaleDateString("en-IN")}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Fee {money(x.finalFee)} · Paid {money(x.invoice?.paid ?? 0)} ·
              Balance {money(Number(x.finalFee) - Number(x.invoice?.paid ?? 0))}
            </p>
          </div>
          {badge(x.status)}
        </div>
      )}
    />
  );
}
function Allocations({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No seat allocations"
      render={(x) => (
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <b>
              {x.seat.room.name} · Seat {x.seat.number}
            </b>
            <p className="text-sm text-[var(--muted)]">{x.shift.name}</p>
          </div>
          {badge(x.status)}
        </div>
      )}
    />
  );
}
function Attendance({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No attendance recorded"
      render={(x) => (
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <b>{new Date(x.checkInAt).toLocaleString("en-IN")}</b>
            <p className="text-sm text-[var(--muted)]">
              Checkout:{" "}
              {x.checkOutAt
                ? new Date(x.checkOutAt).toLocaleString("en-IN")
                : "Currently inside"}
            </p>
          </div>
          {badge(x.status)}
        </div>
      )}
    />
  );
}
function Loans({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No books borrowed"
      render={(x) => (
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <b>{x.copy.book.title}</b>
            <p className="text-sm text-[var(--muted)]">
              Due {new Date(x.dueDate).toLocaleDateString("en-IN")}
            </p>
          </div>
          {badge(x.status)}
        </div>
      )}
    />
  );
}
function Payments({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No payments recorded"
      render={(x) => (
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <b>{x.receiptNo}</b>
            <p className="text-sm text-[var(--muted)]">
              {new Date(x.paidAt).toLocaleString("en-IN")} ·{" "}
              {x.method.replaceAll("_", " ")}
            </p>
          </div>
          <b>{money(x.amount)}</b>
        </div>
      )}
    />
  );
}
function Fines({ items }: { items: any[] }) {
  return (
    <List
      items={items}
      empty="No fines recorded"
      render={(x) => (
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <b>{x.reason}</b>
            <p className="text-sm text-[var(--muted)]">{badge(x.status)}</p>
          </div>
          <b>{money(x.amount)}</b>
        </div>
      )}
    />
  );
}
function History({ member }: { member: MemberDetail }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] p-5 text-sm leading-6 text-[var(--muted)]">
      Member record created on{" "}
      {new Date(member.registrationDate).toLocaleDateString("en-IN")}. Detailed
      administrative changes are preserved in Audit Logs.
    </div>
  );
}
