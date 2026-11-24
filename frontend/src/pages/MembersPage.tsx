import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Phone, Plus, RotateCcw, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, apiPage, json } from "../lib/api";
import { Button, Card, Empty, Modal, PageHeading, Pagination, SearchBox } from "../components/ui";
import { money } from "./ResourcePage";

type Member = {
  id: string;
  publicId: string;
  fullName: string;
  mobile: string;
  email?: string;
  type: string;
  status: string;
  registrationDate: string;
  subscriptions: Array<{ id: string; status: string; startDate: string; endDate: string; plan: { name: string } }>;
  financialSummary: { paidAmount: string; pendingAmount: string };
};
type Plan = {
  id: string;
  name: string;
  price: string;
  duration: number;
  durationUnit: string;
  studyAccess: boolean;
  bookAccess: boolean;
  active: boolean;
};
type Seat = { id: string; number: string; type: string };
type MembershipQuote = { startDate: string; defaultEndDate: string; endDate: string; standardDays: number; assignedDays: number; planPrice: number; calculatedFee: number; discount: number; payableAmount: number };

const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const planMemberType = (plan: Plan) =>
  plan.studyAccess && plan.bookAccess ? "BOTH" : plan.studyAccess ? "STUDY" : "BOOK";
const accessLabel = (plan: Plan) =>
  plan.studyAccess && plan.bookAccess ? "Study + Class" : plan.studyAccess ? "Study" : "Class";

export function MembersPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [seatId, setSeatId] = useState("");
  const qc = useQueryClient();
  const { data: memberPage, isLoading } = useQuery({
    queryKey: ["members", search, type, status, registeredFrom, registeredTo, page, pageSize],
    queryFn: () => apiPage<Member[]>(`/members?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${type ? `&type=${type}` : ""}${status ? `&status=${status}` : ""}${registeredFrom ? `&registeredFrom=${registeredFrom}` : ""}${registeredTo ? `&registeredTo=${registeredTo}` : ""}`),
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["/membership-plans"],
    queryFn: () => api<Plan[]>("/membership-plans"),
  });
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const members = memberPage?.data ?? [];
  const memberTotal = memberPage?.meta.total ?? 0;
  const hasMemberFilters = Boolean(search || type || status || registeredFrom || registeredTo);
  const clearMemberFilters = () => { setSearch(""); setType(""); setStatus(""); setRegisteredFrom(""); setRegisteredTo(""); setPage(1); };
  const { data: quote, isFetching: checkingQuote, error: quoteError } = useQuery({
    queryKey: ["membership-quote", planId, startDate, endDate, discount],
    queryFn: () => api<MembershipQuote>(`/membership-plans/${encodeURIComponent(planId)}/quote?startDate=${startDate}${endDate ? `&endDate=${endDate}` : ""}&discount=${discount}`),
    enabled: Boolean(selectedPlan && startDate),
    retry: false,
  });
  const { data: seats = [], isFetching: checkingSeats, error: seatError } = useQuery({
    queryKey: ["registration-seats", planId, startDate, quote?.endDate],
    queryFn: () => api<Seat[]>(`/members/registration-seats?planId=${encodeURIComponent(planId)}&startDate=${startDate}&endDate=${quote!.endDate}`),
    enabled: Boolean(selectedPlan?.studyAccess && quote?.endDate && !quoteError),
    retry: false,
  });
  const closeRegistration = () => {
    setOpen(false);
    setPlanId("");
    setStartDate(today());
    setEndDate("");
    setDiscount(0);
    setSeatId("");
  };
  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      if (!selectedPlan || !quote) throw new Error("Select a valid membership period.");
      return api<Member>("/members", json("POST", {
        fullName: form.get("fullName"),
        mobile: form.get("mobile"),
        email: form.get("email"),
        address: form.get("address"),
        type: planMemberType(selectedPlan),
        status: "ACTIVE",
        membershipPlanId: selectedPlan.id,
        membershipStartDate: startDate,
        membershipEndDate: quote.endDate,
        membershipDiscount: discount,
        ...(seatId ? { seatId } : {}),
      }));
    },
    onSuccess: () => {
      toast.success(seatId ? "Member, subscription and seat created" : "Member and subscription created");
      closeRegistration();
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["/subscriptions"] });
      qc.invalidateQueries({ queryKey: ["/study-rooms"] });
      qc.invalidateQueries({ queryKey: ["/seat-allocations/seat-map"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <PageHeading
        title="Members"
        description="One unified record for every study and class member."
        action={<Button onClick={() => setOpen(true)}><Plus size={17}/> Add member</Button>}
      />
      <Card>
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex flex-nowrap items-center gap-2 overflow-hidden">
          <div className="min-w-0 flex-1 basis-[220px]">
            <SearchBox value={search} onChange={value=>{setSearch(value);setPage(1)}} placeholder="Search name, member ID or mobile…"/>
          </div>
          <select aria-label="Filter member type" className="input !w-[130px] shrink-0" value={type} onChange={(event) => {setType(event.target.value);setPage(1)}}>
            <option value="">All member types</option>
            <option value="STUDY">Study</option>
            <option value="BOOK">Class</option>
            <option value="BOTH">Study + Class</option>
          </select>
          <select aria-label="Filter member status" className="input !w-[110px] shrink-0" value={status} onChange={(event) => {setStatus(event.target.value);setPage(1)}}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><span>From</span><input aria-label="Registered from" className="input !w-[115px]" type="date" value={registeredFrom} max={registeredTo || undefined} onChange={(event) => {setRegisteredFrom(event.target.value);setPage(1)}}/></label>
          <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><span>To</span><input aria-label="Registered to" className="input !w-[115px]" type="date" value={registeredTo} min={registeredFrom || undefined} onChange={(event) => {setRegisteredTo(event.target.value);setPage(1)}}/></label>
          {hasMemberFilters && <button type="button" className="btn btn-ghost shrink-0 whitespace-nowrap px-3" onClick={clearMemberFilters}><RotateCcw size={15}/> Clear</button>}
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]"><b className="text-[var(--text)]">{memberTotal}</b> matching member{memberTotal === 1 ? "" : "s"}</p>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] text-left">
            <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--muted)]"><th className="px-5 py-3">Member</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Current membership</th><th className="px-5 py-3">Paid</th><th className="px-5 py-3">Pending</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Registered</th><th/></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">{members.map((member) => <tr key={member.id} className="hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"><td className="px-5 py-4"><MemberIdentity member={member}/></td><td className="px-5 py-4"><p className="flex items-center gap-1.5 text-sm"><Phone size={13}/>{member.mobile}</p><p className="mt-1 text-xs text-[var(--muted)]">{member.email || "No email"}</p></td><td className="px-5 py-4"><Tag value={member.type}/></td><td className="px-5 py-4"><MembershipSummary member={member}/></td><td className="px-5 py-4 text-sm font-bold text-emerald-600">{money(member.financialSummary.paidAmount)}</td><td className="px-5 py-4"><p className="text-sm font-bold text-amber-600">{money(member.financialSummary.pendingAmount)}</p></td><td className="px-5 py-4"><Tag value={member.status}/></td><td className="px-5 py-4 text-sm text-[var(--muted)]">{new Date(member.registrationDate).toLocaleDateString("en-IN")}</td><td><Link aria-label={`View ${member.fullName}`} className="btn btn-ghost p-2" to={`/members/${member.id}`}><ArrowRight size={18}/></Link></td></tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-[var(--border)] md:hidden">{members.map((member) => <article key={member.id} className="p-4"><div className="flex items-start gap-3"><MemberIdentity member={member}/><Link aria-label={`View ${member.fullName}`} className="btn btn-ghost ml-auto p-2" to={`/members/${member.id}`}><ArrowRight size={18}/></Link></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-[var(--muted)]">Contact</p><p className="mt-1">{member.mobile}</p></div><div><p className="text-xs text-[var(--muted)]">Type</p><div className="mt-1"><Tag value={member.type}/></div></div><div className="col-span-2"><p className="text-xs text-[var(--muted)]">Current membership</p><div className="mt-1"><MembershipSummary member={member}/></div></div><div><p className="text-xs text-[var(--muted)]">Paid</p><p className="mt-1 font-bold text-emerald-600">{money(member.financialSummary.paidAmount)}</p></div><div><p className="text-xs text-[var(--muted)]">Pending invoices</p><p className="mt-1 font-bold text-amber-600">{money(member.financialSummary.pendingAmount)}</p></div></div></article>)}</div>
        {!isLoading && !members.length && <Empty title="No members found" message={hasMemberFilters ? "Try changing or clearing the filters." : "Register your first member."}/>}<Pagination page={page} pageSize={pageSize} total={memberTotal} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}}/>
      </Card>
      <Modal open={open} onOpenChange={(value) => value ? setOpen(true) : closeRegistration()} title="Register member">
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(new FormData(event.currentTarget)); }} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold sm:col-span-2">Full name<input name="fullName" className="input mt-2" required minLength={2}/></label>
          <label className="text-sm font-semibold">Mobile number<input name="mobile" className="input mt-2" required pattern="[0-9+ -]{8,16}"/></label>
          <label className="text-sm font-semibold">Email (optional)<input type="email" name="email" className="input mt-2"/></label>
          <label className="text-sm font-semibold sm:col-span-2">
            Membership plan
            <select className="input mt-2" value={planId} onChange={(event) => { setPlanId(event.target.value); setEndDate(""); setDiscount(0); setSeatId(""); }} required>
              <option value="" disabled>Select a plan</option>
              {plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {accessLabel(plan)} · {money(plan.price)}</option>)}
            </select>
            {selectedPlan && <span className="mt-1 block text-xs font-normal text-[var(--muted)]">Member type: {accessLabel(selectedPlan)} · Valid for {selectedPlan.duration} {selectedPlan.durationUnit.toLowerCase()}(s)</span>}
          </label>
          <label className="text-sm font-semibold">
            Membership starts
            <input className="input mt-2" type="date" min={today()} value={startDate} onChange={(event) => { setStartDate(event.target.value); setEndDate(""); setSeatId(""); }} required/>
          </label>
          <label className="text-sm font-semibold">
            Membership ends
            <input className="input mt-2" type="date" min={quote?.defaultEndDate} value={endDate || quote?.defaultEndDate || ""} onChange={(event) => { setEndDate(event.target.value); setSeatId(""); }} disabled={!quote || checkingQuote} required/>
          </label>
          <label className="text-sm font-semibold">
            Discount
            <input className="input mt-2" type="number" min="0" max={quote?.calculatedFee} step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value) || 0)} disabled={!selectedPlan}/>
          </label>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm sm:col-span-2">
            {checkingQuote && <p className="text-[var(--muted)]">Calculating membership fee…</p>}
            {quoteError && <p className="font-medium text-rose-600">{quoteError.message}</p>}
            {quote && !checkingQuote && <div className="grid gap-2 sm:grid-cols-4"><div><p className="text-xs text-[var(--muted)]">Plan basis</p><b>{money(quote.planPrice)} / {quote.standardDays} days</b></div><div><p className="text-xs text-[var(--muted)]">Assigned period</p><b>{quote.assignedDays} days</b></div><div><p className="text-xs text-[var(--muted)]">Calculated fee</p><b>{money(quote.calculatedFee)}</b></div><div><p className="text-xs text-[var(--muted)]">Payable after discount</p><b className="text-indigo-600">{money(quote.payableAmount)}</b></div></div>}
          </div>
          {selectedPlan?.studyAccess && (
            <label className="text-sm font-semibold sm:col-span-2">
              Seat allocation (optional)
              <select className="input mt-2" value={seatId} onChange={(event) => setSeatId(event.target.value)} disabled={checkingSeats || Boolean(seatError)}>
                <option value="">{checkingSeats ? "Checking available seats…" : seatError ? "Seat availability could not be checked" : "Do not allocate a seat now"}</option>
                {seats.map((seat) => <option key={seat.id} value={seat.id}>Seat {seat.number} · {seat.type.toLowerCase()}</option>)}
              </select>
              {!checkingSeats && !seatError && <span className="mt-1 block text-xs font-normal text-[var(--muted)]">{seats.length ? `${seats.length} seat${seats.length === 1 ? "" : "s"} available for the complete membership period.` : "No seat is available for the complete membership period. You can register without a seat."}</span>}
              {seatError && <span className="mt-1 block text-xs font-medium text-rose-600">{seatError.message}</span>}
            </label>
          )}
          <label className="text-sm font-semibold sm:col-span-2">Address<textarea name="address" className="input mt-2" rows={3}/></label>
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={closeRegistration}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending} disabled={!selectedPlan || !quote || Boolean(quoteError) || checkingQuote}>Register member</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function MemberIdentity({ member }: { member: Member }) {
  return <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><UserRound size={18}/></div><div><p className="font-semibold">{member.fullName}</p><p className="text-xs text-[var(--muted)]">{member.publicId}</p></div></div>;
}
function MembershipSummary({ member }: { member: Member }) {
  const subscription = member.subscriptions[0];
  if (!subscription) return <span className="text-sm text-[var(--muted)]">No active plan</span>;
  return <div><p className="text-sm font-semibold">{subscription.plan.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{new Date(subscription.startDate).toLocaleDateString("en-IN")} – {new Date(subscription.endDate).toLocaleDateString("en-IN")}</p></div>;
}
function Tag({ value }: { value: string }) {
  const label = value === "BOOK" ? "CLASS" : value === "BOTH" ? "STUDY + CLASS" : value.replaceAll("_", " ");
  return <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{label}</span>;
}
