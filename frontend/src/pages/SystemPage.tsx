import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  DatabaseBackup,
  Download,
  HardDrive,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../lib/api";
import { Button, Card, PageHeading } from "../components/ui";

type Settings = {
  library?: {
    name?: string;
    timezone?: string;
    currency?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  books?: { finePerDay?: string; reservationDays?: number };
  notifications?: { seatExpiryDays?: number };
};
declare global {
  interface Window {
    desktopAPI?: {
      getAutoLaunch(): Promise<boolean>;
      setAutoLaunch(value: boolean): Promise<boolean>;
    };
  }
}

export function ReportsPage() {
  const { data } = useQuery({
    queryKey: ["dashboard-report"],
    queryFn: () => api<any>("/dashboard"),
  });
  const exportSummary = () => {
    if (!data) return;
    const rows = [
      ["Metric", "Value"],
      ...Object.entries(data.stats).map(([key, value]) => [key, String(value)]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `swapnapurti-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      <PageHeading
        title="Reports & Analytics"
        description="Operational summaries calculated from recorded transactions."
        action={
          <Button onClick={exportSummary}>
            <Download size={16} />
            Export summary
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-6">
          <BarChart3 className="text-indigo-600" />
          <p className="mt-5 text-sm text-[var(--muted)]">Monthly collection</p>
          <p className="mt-1 text-2xl font-black">
            ₹
            {Number(data?.stats.monthlyCollections ?? 0).toLocaleString(
              "en-IN",
            )}
          </p>
        </Card>
        <Card className="p-6">
          <TrendingUp className="text-teal-600" />
          <p className="mt-5 text-sm text-[var(--muted)]">Active members</p>
          <p className="mt-1 text-2xl font-black">
            {data?.stats.activeMembers ?? 0}
          </p>
        </Card>
        <Card className="p-6">
          <ShieldCheck className="text-emerald-600" />
          <p className="mt-5 text-sm text-[var(--muted)]">Inventory copies</p>
          <p className="mt-1 text-2xl font-black">{data?.stats.copies ?? 0}</p>
        </Card>
      </div>
      <Card className="mt-5 p-6">
        <h3 className="font-bold">Accounting definitions</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Collections are net payments after refunds recorded in the same
          period. Invoiced amounts, outstanding balances, fines and expenses
          remain separate so totals are never double-counted.
        </p>
      </Card>
    </>
  );
}

export function BackupPage() {
  return (
    <>
      <PageHeading
        title="Backup & Recovery"
        description="Protect the PostgreSQL records that run your library."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
            <DatabaseBackup />
          </div>
          <h3 className="mt-5 text-lg font-bold">Database backup</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Run{" "}
            <code className="rounded bg-slate-100 px-1.5 py-1 dark:bg-slate-800">
              npm run backup
            </code>{" "}
            from the project folder. It creates a timestamped PostgreSQL
            custom-format dump inside the ignored <code>backups</code>{" "}
            directory.
          </p>
        </Card>
        <Card className="p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-600">
            <HardDrive />
          </div>
          <h3 className="mt-5 text-lg font-bold">Recovery safety</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Restore remains a guarded command-line operation because it replaces
            current records. Take a new backup first, verify the target and use
            the confirmation environment variable documented in the README.
          </p>
        </Card>
      </div>
    </>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      await api(
        "/settings/library",
        json("PUT", {
          name: form.get("name"),
          address: form.get("address"),
          phone: form.get("phone"),
          email: form.get("email"),
          timezone: "Asia/Kolkata",
          currency: "INR",
        }),
      );
      await api(
        "/settings/books",
        json("PUT", {
          finePerDay: form.get("finePerDay"),
          reservationDays: Number(form.get("reservationDays")),
        }),
      );
      await api(
        "/settings/notifications",
        json("PUT", { seatExpiryDays: Number(form.get("seatExpiryDays")) }),
      );
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["/notifications"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <PageHeading
        title="Settings"
        description="Operational defaults used throughout the system."
      />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <h3 className="font-bold">Library, book and reminder settings</h3>
          {data && (
            <form
              className="mt-5 grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate(new FormData(e.currentTarget));
              }}
            >
              <label className="text-sm font-semibold sm:col-span-2">
                Library name
                <input
                  name="name"
                  className="input mt-2"
                  defaultValue={data.library?.name ?? "Swapnapurti Library"}
                  required
                />
              </label>
              <label className="text-sm font-semibold sm:col-span-2">
                Address
                <textarea
                  name="address"
                  className="input mt-2"
                  defaultValue={data.library?.address ?? ""}
                  rows={2}
                />
              </label>
              <label className="text-sm font-semibold">
                Phone
                <input
                  name="phone"
                  className="input mt-2"
                  defaultValue={data.library?.phone ?? ""}
                />
              </label>
              <label className="text-sm font-semibold">
                Email
                <input
                  name="email"
                  type="email"
                  className="input mt-2"
                  defaultValue={data.library?.email ?? ""}
                />
              </label>
              <label className="text-sm font-semibold">
                Overdue fine / day
                <input
                  name="finePerDay"
                  type="number"
                  min="0"
                  step="0.01"
                  className="input mt-2"
                  defaultValue={data.books?.finePerDay ?? "5.00"}
                />
              </label>
              <label className="text-sm font-semibold">
                Reservation validity (days)
                <input
                  name="reservationDays"
                  type="number"
                  min="1"
                  className="input mt-2"
                  defaultValue={data.books?.reservationDays ?? 2}
                />
              </label>
              <label className="text-sm font-semibold sm:col-span-2">
                Seat-expiry reminder (days before)
                <input
                  name="seatExpiryDays"
                  type="number"
                  min="1"
                  max="30"
                  className="input mt-2"
                  defaultValue={data.notifications?.seatExpiryDays ?? 3}
                  required
                />
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  One in-app reminder is created per allocation within this
                  window.
                </span>
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" loading={mutation.isPending}>
                  Save settings
                </Button>
              </div>
            </form>
          )}
        </Card>
        <Card className="p-6">
          <h3 className="font-bold">Desktop experience</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            The desktop edition starts its required local services
            automatically. Windows login startup is available only inside the
            desktop application.
          </p>
          <Button
            disabled={!window.desktopAPI}
            className="mt-5"
            onClick={async () => {
              const enabled = await window.desktopAPI?.setAutoLaunch(
                !(autoLaunch ?? false),
              );
              setAutoLaunch(Boolean(enabled));
              toast.success(
                enabled
                  ? "Windows startup enabled"
                  : "Windows startup disabled",
              );
            }}
          >
            {autoLaunch ? "Disable Windows startup" : "Enable Windows startup"}
          </Button>
          {!window.desktopAPI && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Open the portable desktop edition to change this option.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
