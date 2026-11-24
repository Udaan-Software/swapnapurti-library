import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, PageHeading } from "../components/ui";
import { Users, Armchair, IndianRupee, UserCheck, AlertTriangle, ArrowUpRight, CreditCard, CalendarClock } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";

type DashboardData = {
  stats: {
    activeMembers: number;
    newMembers: number;
    seats: number;
    availableSeats: number;
    inside: number;
    pendingAmount: number;
    expiredMemberships: number;
    todayCollections: number;
    monthlyCollections: number;
  };
  charts: { revenue: { month: string; amount: number }[] };
  alerts: {
    expiring: Array<{ id: string; endDate: string; member: { fullName: string } }>;
    seatExpiring: Array<{ id: string; endDate: string; member: { fullName: string }; seat: { number: string } }>;
  };
};
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/dashboard"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const stats = [
    { label: "Active members", value: data?.stats.activeMembers, sub: data ? `${data.stats.newMembers} new this month` : "Registered active profiles", icon: Users, tone: "bg-indigo-50 text-indigo-600" },
    { label: "Available seats", value: data?.stats.availableSeats, sub: data ? `of ${data.stats.seats} operational seats` : "Current availability", icon: Armchair, tone: "bg-cyan-50 text-cyan-700" },
    { label: "Currently inside", value: data?.stats.inside, sub: "Live attendance", icon: UserCheck, tone: "bg-emerald-50 text-emerald-600" },
    { label: "Pending amount", value: data ? money(data.stats.pendingAmount) : undefined, sub: "Outstanding membership invoices", icon: CreditCard, tone: "bg-rose-50 text-rose-600" },
    { label: "Expired memberships", value: data?.stats.expiredMemberships, sub: "Members requiring renewal", icon: CalendarClock, tone: "bg-violet-50 text-violet-600" },
    { label: "Today's collection", value: data ? money(data.stats.todayCollections) : undefined, sub: data ? `${money(data.stats.monthlyCollections)} this month` : "Net recorded payments", icon: IndianRupee, tone: "bg-fuchsia-50 text-fuchsia-600" },
  ];
  const quick = [
    { to: "/members", label: "Add member" },
    { to: "/seats", label: "Assign seat" },
    { to: "/payments", label: "Collect payment" },
  ];
  const attention = [
    ...(data?.alerts.expiring ?? []).map((item) => ({
      id: `membership-${item.id}`,
      title: item.member.fullName,
      detail: `Membership expires ${format(new Date(item.endDate), "dd MMM")}`,
      tone: "bg-amber-50 text-amber-600",
    })),
    ...(data?.alerts.seatExpiring ?? []).map((item) => ({
      id: `seat-${item.id}`,
      title: item.member.fullName,
      detail: `Seat ${item.seat.number} allocation ends ${format(new Date(item.endDate), "dd MMM")}`,
      tone: "bg-rose-50 text-rose-600",
    })),
  ].slice(0, 6);
  return (
    <>
      <PageHeading title="Good morning, Administrator" description="Here’s what’s happening across Swapnapurti Library today."/>
      {error && <Card className="mb-5 border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">Dashboard data could not be loaded. Please retry or check the server connection.</Card>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="group p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--muted)]">{stat.label}</p>
                <p className="mt-2 text-3xl font-black tracking-tight">{isLoading || stat.value === undefined ? "—" : stat.value}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">{stat.sub}</p>
              </div>
              <div className={`grid h-11 w-11 place-items-center rounded-xl ${stat.tone}`}><stat.icon size={21}/></div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-bold">Quick actions</span>
          {quick.map((item) => <Link key={item.to} to={item.to} className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950/30">{item.label}</Link>)}
        </div>
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <div><h3 className="font-bold">Collection trend</h3><p className="text-sm text-[var(--muted)]">Net recorded payments, last six months</p></div>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Live data</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.charts.revenue ?? []}>
                <defs><linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/><stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)"/>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }}/>
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }}/>
                <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}/>
                <Area type="monotone" dataKey="amount" stroke="#4f46e5" strokeWidth={3} fill="url(#revenue)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border)] p-5"><h3 className="font-bold">Needs attention</h3><p className="text-sm text-[var(--muted)]">Membership and seat expiries</p></div>
          <div className="divide-y divide-[var(--border)]">
            {attention.map((item) => <div key={item.id} className="flex items-center gap-3 p-4"><div className={`grid h-9 w-9 place-items-center rounded-xl ${item.tone}`}><AlertTriangle size={17}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="truncate text-xs text-[var(--muted)]">{item.detail}</p></div><ArrowUpRight size={16} className="text-[var(--muted)]"/></div>)}
            {!attention.length && !isLoading && !error && <div className="p-10 text-center text-sm text-[var(--muted)]">Everything looks clear.</div>}
            {isLoading && <div className="p-10 text-center text-sm text-[var(--muted)]">Checking current alerts…</div>}
          </div>
        </Card>
      </div>
    </>
  );
}
