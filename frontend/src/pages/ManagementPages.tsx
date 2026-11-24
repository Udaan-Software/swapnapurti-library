import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Armchair,
  Check,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../lib/api";
import { Button, Card, Modal, PageHeading } from "../components/ui";
import { ResourcePage, badge, money } from "./ResourcePage";

type Item = { id: string; [key: string]: any };
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
function useItems(endpoint: string) {
  return (
    useQuery({ queryKey: [endpoint], queryFn: () => api<Item[]>(endpoint) })
      .data ?? []
  );
}
function Options({
  items,
  label,
}: {
  items: Item[];
  label: (item: Item) => string;
}) {
  return (
    <>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {label(item)}
        </option>
      ))}
    </>
  );
}
function ActionForm({
  open,
  onClose,
  title,
  endpoint,
  invalidate,
  method = "POST",
  transform,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  endpoint: string;
  invalidate: string[];
  method?: "POST" | "PATCH";
  transform?: (form: FormData) => unknown;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api(
        endpoint,
        json(method, transform ? transform(form) : Object.fromEntries(form)),
      ),
    onSuccess: async () => {
      toast.success(`${title} completed`);
      onClose();
      await Promise.all(
        invalidate.map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      await qc.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Modal
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={title}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(new FormData(e.currentTarget));
        }}
      >
        {children}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
const labelClass = "text-sm font-semibold";
const full = "sm:col-span-2";

const planPayload = (form: FormData) => ({
  name: form.get("name"),
  type: form.get("type"),
  price: form.get("price"),
  duration: form.get("duration"),
  durationUnit: form.get("durationUnit"),
  studyAccess: form.get("studyAccess") === "on",
  bookAccess: form.get("classAccess") === "on",
  maxBooks: 0,
  loanDays: 0,
  renewalLimit: 0,
  description: form.get("description") || null,
  active: form.get("active") === "on",
  allowedShiftIds: [],
});
function PlanFields({ plan }: { plan?: Item }) {
  return (
    <>
      <label className={`${labelClass} ${full}`}>
        Plan name
        <input
          className="input mt-2"
          name="name"
          defaultValue={plan?.name ?? ""}
          required
        />
      </label>
      <label className={labelClass}>
        Type
        <select
          className="input mt-2"
          name="type"
          defaultValue={plan?.type ?? "STUDY_MONTHLY"}
        >
          <option value="STUDY_MONTHLY">Study monthly</option>
          <option value="STUDY_QUARTERLY">Study quarterly</option>
          <option value="STUDY_HALF_YEARLY">Study half-yearly</option>
          <option value="STUDY_YEARLY">Study yearly</option>
          <option value="BOOK">Class</option>
          <option value="COMBINED">Study + Class</option>
          <option value="CUSTOM">Custom</option>
        </select>
      </label>
      <label className={labelClass}>
        Price
        <input
          className="input mt-2"
          name="price"
          type="number"
          min="0"
          step="0.01"
          defaultValue={plan?.price ?? ""}
          required
        />
      </label>
      <label className={labelClass}>
        Duration
        <input
          className="input mt-2"
          name="duration"
          type="number"
          min="1"
          defaultValue={plan?.duration ?? 1}
          required
        />
      </label>
      <label className={labelClass}>
        Unit
        <select
          className="input mt-2"
          name="durationUnit"
          defaultValue={plan?.durationUnit ?? "MONTH"}
        >
          <option value="MONTH">Months</option>
          <option value="DAY">Days</option>
          <option value="YEAR">Years</option>
        </select>
      </label>
      <label className={`${labelClass} ${full}`}>
        Description
        <textarea
          className="input mt-2"
          name="description"
          rows={2}
          defaultValue={plan?.description ?? ""}
        />
      </label>
      <div className={`${full} flex flex-wrap items-center gap-5`}>
        <label>
          <input
            type="checkbox"
            name="studyAccess"
            defaultChecked={plan?.studyAccess ?? false}
          />{" "}
          Study access
        </label>
        <label>
          <input
            type="checkbox"
            name="classAccess"
            defaultChecked={plan?.bookAccess ?? false}
          />{" "}
          Class access
        </label>
        <label>
          <input
            type="checkbox"
            name="active"
            defaultChecked={plan?.active ?? true}
          />{" "}
          Active plan
        </label>
      </div>
    </>
  );
}
export function PlansPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  return (
    <>
      <ResourcePage
        title="Membership Plans"
        description="Configurable study, class and combined access plans."
        endpoint="/membership-plans"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            New plan
          </Button>
        }
        rowAction={(plan) => (
          <Button variant="ghost" onClick={() => setEditing(plan)}>
            <Pencil size={15} />
            Edit
          </Button>
        )}
        columns={[
          { label: "Plan", value: (r) => <b>{r.name}</b> },
          { label: "Type", value: (r) => badge(r.type === "BOOK" ? "CLASS" : r.type === "COMBINED" ? "STUDY + CLASS" : r.type) },
          { label: "Price", value: (r) => money(r.price) },
          {
            label: "Validity",
            value: (r) => `${r.duration} ${r.durationUnit.toLowerCase()}(s)`,
          },
          {
            label: "Access",
            value: (r) =>
              [r.studyAccess && "Study", r.bookAccess && "Class"]
                .filter(Boolean)
                .join(" + ") || "None",
          },
          {
            label: "Status",
            value: (r) => badge(r.active ? "ACTIVE" : "INACTIVE"),
          },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Create membership plan"
        endpoint="/membership-plans"
        invalidate={["/membership-plans"]}
        transform={planPayload}
      >
        <PlanFields />
      </ActionForm>
      {editing && (
        <ActionForm
          open
          onClose={() => setEditing(null)}
          title="Edit membership plan"
          endpoint={`/membership-plans/${editing.id}`}
          method="PATCH"
          invalidate={["/membership-plans", "/subscriptions"]}
          transform={planPayload}
        >
          <PlanFields plan={editing} />
        </ActionForm>
      )}
    </>
  );
}

export function SubscriptionsPage() {
  const [open, setOpen] = useState(false);
  const members = useItems("/members?pageSize=100");
  const plans = useItems("/membership-plans");
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/subscriptions/${id}/cancel`, json("POST", { reason })),
    onSuccess: async () => {
      toast.success("Membership cancelled");
      await qc.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <ResourcePage
        title="Subscriptions"
        description="Membership eligibility, expiry and payment status."
        endpoint="/subscriptions"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Assign plan
          </Button>
        }
        rowAction={(subscription) =>
          ["ACTIVE", "PENDING", "SUSPENDED"].includes(subscription.status) ? (
            <Button
              variant="ghost"
              onClick={() => {
                const reason = window.prompt(
                  "Reason for cancelling this membership",
                );
                if (reason) cancel.mutate({ id: subscription.id, reason });
              }}
            >
              Cancel
            </Button>
          ) : null
        }
        columns={[
          {
            label: "Member",
            value: (r) => (
              <>
                <b>{r.member.fullName}</b>
                <div className="text-xs text-[var(--muted)]">
                  {r.member.publicId}
                </div>
              </>
            ),
          },
          { label: "Plan", value: (r) => r.plan.name },
          {
            label: "Period",
            value: (r) =>
              `${new Date(r.startDate).toLocaleDateString("en-IN")} — ${new Date(r.endDate).toLocaleDateString("en-IN")}`,
          },
          { label: "Status", value: (r) => badge(r.status) },
          { label: "Fee", value: (r) => money(r.finalFee) },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Assign membership plan"
        endpoint="/subscriptions"
        invalidate={["/subscriptions", "/dashboard"]}
        transform={(f) => ({
          memberId: f.get("memberId"),
          planId: f.get("planId"),
          startDate: f.get("startDate"),
          discount: f.get("discount"),
        })}
      >
        <label className={`${labelClass} ${full}`}>
          Member
          <select
            className="input mt-2"
            name="memberId"
            required
            defaultValue=""
          >
            <option value="" disabled>
              Select a member
            </option>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
        <label className={`${labelClass} ${full}`}>
          Plan
          <select className="input mt-2" name="planId" required defaultValue="">
            <option value="" disabled>
              Select a plan
            </option>
            <Options
              items={plans.filter((x) => x.active)}
              label={(x) => `${x.name} · ${money(x.price)}`}
            />
          </select>
        </label>
        <label className={labelClass}>
          Start date
          <input
            className="input mt-2"
            name="startDate"
            type="date"
            defaultValue={today()}
            required
          />
        </label>
        <label className={labelClass}>
          Discount
          <input
            className="input mt-2"
            name="discount"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0"
          />
        </label>
      </ActionForm>
    </>
  );
}

function SeatAllocationForm({
  members,
  shifts,
  onClose,
}: {
  members: Item[];
  shifts: Item[];
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const shiftId = shifts.find((shift) => shift.active)?.id ?? "";
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const ready = Boolean(
    memberId && shiftId && startDate && endDate && endDate >= startDate,
  );
  const {
    data: seats = [],
    isFetching,
    error,
  } = useQuery({
    queryKey: ["available-seats", memberId, shiftId, startDate, endDate],
    queryFn: () =>
      api<Item[]>(
        `/seat-allocations/available-seats?memberId=${encodeURIComponent(memberId)}&shiftId=${encodeURIComponent(shiftId)}&startDate=${startDate}&endDate=${endDate}`,
      ),
    enabled: ready,
    retry: false,
  });
  return (
    <ActionForm
      open
      onClose={onClose}
      title="Assign study seat"
      endpoint="/seat-allocations"
      invalidate={[
        "/study-rooms",
        "/seat-allocations",
        "/seat-allocations/seat-map",
        "/dashboard",
      ]}
    >
      <label className={`${labelClass} ${full}`}>
        Member
        <select
          name="memberId"
          className="input mt-2"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          required
        >
          <option value="" disabled>
            Select a member
          </option>
          <Options
            items={members}
            label={(x) => `${x.publicId} · ${x.fullName}`}
          />
        </select>
      </label>
      <input type="hidden" name="shiftId" value={shiftId} />
      <label className={labelClass}>
        From
        <input
          name="startDate"
          className="input mt-2"
          type="date"
          value={startDate}
          min={today()}
          onChange={(event) => {
            setStartDate(event.target.value);
            if (endDate < event.target.value) setEndDate(event.target.value);
          }}
          required
        />
      </label>
      <label className={labelClass}>
        Until
        <input
          name="endDate"
          className="input mt-2"
          type="date"
          min={startDate}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          required
        />
      </label>
      <label className={`${labelClass} ${full}`}>
        Available seat
        <select
          name="seatId"
          className="input mt-2"
          required
          disabled={!ready || isFetching || Boolean(error) || !seats.length}
          defaultValue=""
        >
          <option value="" disabled>
            {!ready
              ? "Select a member and dates first"
              : isFetching
                ? "Checking availability…"
                : error
                  ? "Availability could not be checked"
                  : seats.length
                    ? `Select from ${seats.length} available seat${seats.length === 1 ? "" : "s"}`
                    : "No seats available for this period"}
          </option>
          <Options
            items={seats}
            label={(x) => `Seat ${x.number}`}
          />
        </select>
        {error && (
          <p className="mt-2 text-xs font-medium text-rose-600">
            {error.message}
          </p>
        )}
        {ready && !isFetching && !error && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Only seats free for the complete date range are shown.
          </p>
        )}
      </label>
    </ActionForm>
  );
}

const seatTone: Record<string, string> = {
  AVAILABLE: "seat-available",
  OCCUPIED: "seat-occupied",
  RESERVED: "seat-reserved",
  MAINTENANCE: "seat-maintenance",
  DISABLED: "seat-disabled",
};
function SeatMap({
  shifts,
  onEditSeat,
}: {
  shifts: Item[];
  onEditSeat: (seat: Item) => void;
}) {
  const activeShifts = shifts.filter((shift) => shift.active),
    shiftId = activeShifts[0]?.id ?? "",
    [date, setDate] = useState(today()),
    [selected, setSelected] = useState("");
  const endpoint = `/seat-allocations/seat-map?shiftId=${encodeURIComponent(shiftId)}&date=${date}`;
  const {
    data: rooms = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["/seat-allocations/seat-map", shiftId, date],
    queryFn: () => api<Item[]>(endpoint),
    enabled: Boolean(shiftId),
  });
  const allSeats = rooms.flatMap((room) => room.seats as Item[]),
    count = (status: string) =>
      allSeats.filter((seat) => seat.displayStatus === status).length;
  return (
    <Card className="mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold">Live seat layout</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Choose a date, then click a seat to see its allocation.
          </p>
        </div>
        <div className="grid w-full gap-3 sm:w-auto">
          <label className={labelClass}>
            Date
            <input
              className="input mt-2"
              type="date"
              min={today()}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setSelected("");
              }}
            />
          </label>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold">
        <span className="seat-legend seat-available">
          Available {count("AVAILABLE")}
        </span>
        <span className="seat-legend seat-reserved">
          Reserved {count("RESERVED")}
        </span>
      </div>
      {isLoading && (
        <div className="py-12 text-center text-sm text-[var(--muted)]">
          Arranging live seats…
        </div>
      )}
      {error && (
        <div className="py-12 text-center text-sm text-rose-600">
          {error.message}
        </div>
      )}
      {!activeShifts.length && (
        <div className="py-12 text-center text-sm text-[var(--muted)]">
          The permanent study schedule is not configured.
        </div>
      )}
      <div className="mt-6 space-y-6">
        {rooms.map((room) => (
          <section
            key={room.id}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4"
          >
            <div className="mb-4 flex items-center justify-end">
              <span className="text-xs font-bold text-[var(--muted)]">
                {room.seats.length} seats
              </span>
            </div>
            <div className="seat-grid">
              {room.seats.map((seat: Item) => (
                <button
                  type="button"
                  key={seat.id}
                  className={`seat-visual ${seatTone[seat.displayStatus] ?? "seat-disabled"} ${selected === seat.id ? "seat-selected" : ""}`}
                  onClick={() =>
                    setSelected((current) =>
                      current === seat.id ? "" : seat.id,
                    )
                  }
                  aria-label={`Seat ${seat.number}, ${seat.displayStatus}`}
                  aria-pressed={selected === seat.id}
                >
                  <span className="seat-status-dot" />
                  <Armchair size={30} />
                  <strong>{seat.number}</strong>
                  <small>{seat.displayStatus.toLowerCase()}</small>
                  {selected === seat.id && (
                    <span className="seat-detail">
                      <b>Seat {seat.number}</b>
                      {seat.allocation ? (
                        <>
                          <span className="seat-member">
                            <UserRound size={14} />
                            {seat.allocation.member.fullName}
                          </span>
                          <span>{seat.allocation.member.publicId}</span>
                          <span>
                            {new Date(
                              seat.allocation.startDate,
                            ).toLocaleDateString("en-IN")}{" "}
                            –{" "}
                            {new Date(
                              seat.allocation.endDate,
                            ).toLocaleDateString("en-IN")}
                          </span>
                          <span>
                            {seat.displayStatus === "OCCUPIED"
                              ? "Student is checked in"
                              : "Seat is reserved; student is not checked in"}
                          </span>
                        </>
                      ) : (
                        <span>
                          {seat.displayStatus === "AVAILABLE"
                            ? "Ready for allocation"
                            : seat.notes || seat.displayStatus.toLowerCase()}
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={0}
                        className="mt-1 font-bold text-indigo-600"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditSeat(seat);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            onEditSeat(seat);
                          }
                        }}
                      >
                        Edit seat details
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}
export function RoomsSeatsPage() {
  const [seatOpen, setSeatOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [editingSeat, setEditingSeat] = useState<Item | null>(null);
  const shifts = useItems("/shifts");
  const members = useItems("/members?pageSize=100");
  const rooms = useItems("/study-rooms");
  const primaryRoom = rooms.find((room) => room.active) ?? rooms[0];
  return (
    <>
      <PageHeading
        title="Seats"
        description="Visual availability and conflict-safe seat allocation."
        action={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!primaryRoom}
              onClick={() => setSeatOpen(true)}
            >
              <Plus size={17} />
              Add seat
            </Button>
            <Button onClick={() => setAllocationOpen(true)}>Assign seat</Button>
          </div>
        }
      />
      <SeatMap shifts={shifts} onEditSeat={setEditingSeat} />
      <ActionForm
        open={seatOpen}
        onClose={() => setSeatOpen(false)}
        title="Add seat"
        endpoint={`/study-rooms/${primaryRoom?.id ?? "unavailable"}/seats`}
        invalidate={[
          "/study-rooms",
          "/seat-allocations/seat-map",
          "/dashboard",
        ]}
        transform={(form) => ({
          number: form.get("number"),
          type: form.get("type"),
        })}
      >
        <label className={`${labelClass} ${full}`}>
          Seat number
          <input name="number" className="input mt-2" required />
        </label>
        <label className={`${labelClass} ${full}`}>
          Seat type
          <select name="type" className="input mt-2" defaultValue="STANDARD">
            <option value="STANDARD">Standard</option>
            <option value="PREMIUM">Premium</option>
            <option value="ACCESSIBLE">Accessible</option>
          </select>
        </label>
      </ActionForm>
      {editingSeat && (
        <ActionForm
          open
          onClose={() => setEditingSeat(null)}
          title={`Edit seat ${editingSeat.number}`}
          endpoint={`/study-rooms/seats/${editingSeat.id}`}
          method="PATCH"
          invalidate={["/study-rooms", "/seat-allocations/seat-map"]}
          transform={(form) => ({
            status: form.get("status"),
            notes: form.get("notes") || null,
            active: form.get("active") === "on",
          })}
        >
          <label className={`${labelClass} ${full}`}>
            Operational status
            <select
              name="status"
              className="input mt-2"
              defaultValue={editingSeat.status}
            >
              <option value="AVAILABLE">Available</option>
              <option value="ALLOCATED">Allocated</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="DISABLED">Disabled</option>
            </select>
          </label>
          <label className={`${labelClass} ${full}`}>
            Notes
            <textarea
              name="notes"
              className="input mt-2"
              rows={3}
              defaultValue={editingSeat.notes ?? ""}
            />
          </label>
          <label className={full}>
            <input
              type="checkbox"
              name="active"
              defaultChecked={editingSeat.active}
            />{" "}
            Active seat
          </label>
        </ActionForm>
      )}
      {allocationOpen && (
        <SeatAllocationForm
          members={members}
          shifts={shifts}
          onClose={() => setAllocationOpen(false)}
        />
      )}
    </>
  );
}
const shiftPayload = (form: FormData) => ({
  name: form.get("name"),
  startMinutes: toMinutes(String(form.get("start"))),
  endMinutes: toMinutes(String(form.get("end"))),
  fullDay: form.get("fullDay") === "on",
  crossesMidnight: form.get("crossesMidnight") === "on",
  active: form.get("active") === "on",
});
function ShiftFields({ shift }: { shift?: Item }) {
  return (
    <>
      <label className={`${labelClass} ${full}`}>
        Shift name
        <input
          name="name"
          className="input mt-2"
          defaultValue={shift?.name ?? ""}
          required
        />
      </label>
      <label className={labelClass}>
        Start time
        <input
          name="start"
          className="input mt-2"
          type="time"
          defaultValue={shift ? minutes(shift.startMinutes) : ""}
          required
        />
      </label>
      <label className={labelClass}>
        End time
        <input
          name="end"
          className="input mt-2"
          type="time"
          defaultValue={shift ? minutes(shift.endMinutes) : ""}
          required
        />
      </label>
      <label>
        <input
          type="checkbox"
          name="fullDay"
          defaultChecked={shift?.fullDay ?? false}
        />{" "}
        Full-day access
      </label>
      <label>
        <input
          type="checkbox"
          name="crossesMidnight"
          defaultChecked={shift?.crossesMidnight ?? false}
        />{" "}
        Crosses midnight
      </label>
      <label className={full}>
        <input
          type="checkbox"
          name="active"
          defaultChecked={shift?.active ?? true}
        />{" "}
        Active shift
      </label>
    </>
  );
}
export function ShiftsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  return (
    <>
      <ResourcePage
        title="Study Shifts"
        description="Configurable access windows and full-day schedules."
        endpoint="/shifts"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            New shift
          </Button>
        }
        rowAction={(shift) => (
          <Button variant="ghost" onClick={() => setEditing(shift)}>
            <Pencil size={15} />
            Edit
          </Button>
        )}
        columns={[
          { label: "Shift", value: (r) => <b>{r.name}</b> },
          { label: "Starts", value: (r) => minutes(r.startMinutes) },
          { label: "Ends", value: (r) => minutes(r.endMinutes) },
          {
            label: "Type",
            value: (r) =>
              badge(
                r.fullDay
                  ? "FULL DAY"
                  : r.crossesMidnight
                    ? "OVERNIGHT"
                    : "STANDARD",
              ),
          },
          {
            label: "Status",
            value: (r) => badge(r.active ? "ACTIVE" : "INACTIVE"),
          },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Create study shift"
        endpoint="/shifts"
        invalidate={["/shifts"]}
        transform={shiftPayload}
      >
        <ShiftFields />
      </ActionForm>
      {editing && (
        <ActionForm
          open
          onClose={() => setEditing(null)}
          title="Edit study shift"
          endpoint={`/shifts/${editing.id}`}
          method="PATCH"
          invalidate={["/shifts", "/study-rooms"]}
          transform={shiftPayload}
        >
          <ShiftFields shift={editing} />
        </ActionForm>
      )}
    </>
  );
}
const minutes = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
const dateTimeLocal = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function AttendancePage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const members = useItems("/members?pageSize=100");
  const qc = useQueryClient();
  const checkout = useMutation({
    mutationFn: (id: string) =>
      api(`/attendance/${id}/check-out`, json("POST")),
    onSuccess: () => {
      toast.success("Member checked out");
      qc.invalidateQueries({ queryKey: ["/attendance"] });
      qc.invalidateQueries({ queryKey: ["/dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <ResourcePage
        title="Attendance"
        description="Validated check-in sessions and auditable corrections."
        endpoint="/attendance"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Check in
          </Button>
        }
        rowAction={(r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" onClick={() => setEditing(r)}>
              <Pencil size={15} />
              Correct
            </Button>
            {r.status === "OPEN" && (
              <Button
                variant="ghost"
                onClick={() => checkout.mutate(r.id)}
                loading={checkout.isPending}
              >
                <LogOut size={16} />
                Check out
              </Button>
            )}
          </div>
        )}
        columns={[
          { label: "Member", value: (r) => <b>{r.member.fullName}</b> },
          {
            label: "Check in",
            value: (r) => new Date(r.checkInAt).toLocaleString("en-IN"),
          },
          {
            label: "Check out",
            value: (r) =>
              r.checkOutAt
                ? new Date(r.checkOutAt).toLocaleString("en-IN")
                : "Currently inside",
          },
          { label: "Status", value: (r) => badge(r.status) },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Check member in"
        endpoint="/attendance/check-in"
        invalidate={["/attendance", "/dashboard"]}
        transform={(f) => ({
          memberId: f.get("memberId"),
        })}
      >
        <label className={`${labelClass} ${full}`}>
          Member
          <select name="memberId" className="input mt-2" required>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
      </ActionForm>
      {editing && (
        <ActionForm
          open
          onClose={() => setEditing(null)}
          title="Correct attendance"
          endpoint={`/attendance/${editing.id}/correct`}
          method="PATCH"
          invalidate={[
            "/attendance",
            "/seat-allocations/seat-map",
            "/dashboard",
          ]}
          transform={(f) => ({
            checkInAt: new Date(String(f.get("checkInAt"))).toISOString(),
            checkOutAt: f.get("checkOutAt")
              ? new Date(String(f.get("checkOutAt"))).toISOString()
              : null,
            reason: f.get("reason"),
          })}
        >
          <label className={labelClass}>
            Check in
            <input
              name="checkInAt"
              className="input mt-2"
              type="datetime-local"
              defaultValue={dateTimeLocal(editing.checkInAt)}
              required
            />
          </label>
          <label className={labelClass}>
            Check out
            <input
              name="checkOutAt"
              className="input mt-2"
              type="datetime-local"
              defaultValue={
                editing.checkOutAt ? dateTimeLocal(editing.checkOutAt) : ""
              }
            />
          </label>
          <label className={`${labelClass} ${full}`}>
            Correction reason
            <textarea
              name="reason"
              className="input mt-2"
              minLength={5}
              rows={2}
              required
            />
          </label>
        </ActionForm>
      )}
    </>
  );
}

export function BooksPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const categories = useItems("/books/categories");
  const fields = (book?: Item) => (
    <>
      <label className={`${labelClass} ${full}`}>
        Title
        <input
          name="title"
          className="input mt-2"
          defaultValue={book?.title ?? ""}
          required
        />
      </label>
      <label className={`${labelClass} ${full}`}>
        Author(s)
        <input
          name="authors"
          className="input mt-2"
          defaultValue={book?.authors ?? ""}
          required
        />
      </label>
      <label className={labelClass}>
        ISBN
        <input
          name="isbn"
          className="input mt-2"
          defaultValue={book?.isbn ?? ""}
        />
      </label>
      <label className={labelClass}>
        Category
        <select
          name="categoryId"
          className="input mt-2"
          defaultValue={book?.categoryId ?? ""}
        >
          <option value="">Uncategorised</option>
          <Options items={categories} label={(x) => x.name} />
        </select>
      </label>
      <label className={labelClass}>
        Language
        <input
          name="language"
          className="input mt-2"
          defaultValue={book?.language ?? "English"}
        />
      </label>
      <label className={labelClass}>
        Shelf location
        <input
          name="shelfLocation"
          className="input mt-2"
          defaultValue={book?.shelfLocation ?? ""}
        />
      </label>
      {!book && (
        <label className={labelClass}>
          Physical copies
          <input
            name="copies"
            className="input mt-2"
            type="number"
            min="0"
            defaultValue="1"
          />
        </label>
      )}
      <label className={`${labelClass} ${full}`}>
        Description
        <textarea
          name="description"
          className="input mt-2"
          rows={2}
          defaultValue={book?.description ?? ""}
        />
      </label>
      {book && (
        <label className={full}>
          <input
            type="checkbox"
            name="archived"
            defaultChecked={book.archived}
          />{" "}
          Archive title
        </label>
      )}
    </>
  );
  const payload = (f: FormData, editing = false) => ({
    title: f.get("title"),
    authors: f.get("authors"),
    isbn: f.get("isbn") || null,
    categoryId: f.get("categoryId") || null,
    language: f.get("language"),
    shelfLocation: f.get("shelfLocation") || null,
    description: f.get("description") || null,
    ...(editing
      ? { archived: f.get("archived") === "on" }
      : { copies: Number(f.get("copies")) }),
  });
  return (
    <>
      <ResourcePage
        title="Book Catalog"
        description="Title-level catalog with individually tracked copies."
        endpoint="/books"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Add title
          </Button>
        }
        rowAction={(book) => (
          <Button variant="ghost" onClick={() => setEditing(book)}>
            <Pencil size={15} />
            Edit
          </Button>
        )}
        columns={[
          {
            label: "Title",
            value: (r) => (
              <>
                <b>{r.title}</b>
                <div className="text-xs text-[var(--muted)]">{r.authors}</div>
              </>
            ),
          },
          { label: "Category", value: (r) => r.category?.name || "—" },
          { label: "Shelf", value: (r) => r.shelfLocation || "—" },
          { label: "Copies", value: (r) => r.copies.length },
          {
            label: "Available",
            value: (r) =>
              r.copies.filter((c: Item) => c.status === "AVAILABLE").length,
          },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Add book title"
        endpoint="/books"
        invalidate={["/books", "/dashboard"]}
        transform={(f) => payload(f)}
      >
        {fields()}
      </ActionForm>
      {editing && (
        <ActionForm
          open
          onClose={() => setEditing(null)}
          title="Edit catalog title"
          endpoint={`/books/${editing.id}`}
          method="PATCH"
          invalidate={["/books"]}
          transform={(f) => payload(f, true)}
        >
          {fields(editing)}
        </ActionForm>
      )}
    </>
  );
}

export function LoansPage() {
  const [open, setOpen] = useState(false);
  const members = useItems("/members?pageSize=100");
  const books = useItems("/books?pageSize=100");
  const copies = books.flatMap((book) =>
    book.copies
      .filter((copy: Item) => copy.status === "AVAILABLE")
      .map((copy: Item) => ({ ...copy, title: book.title })),
  );
  const qc = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "return" | "renew" }) =>
      api(
        `/loans/${id}/${type}`,
        json("POST", type === "return" ? { condition: "GOOD" } : undefined),
      ),
    onSuccess: (_, v) => {
      toast.success(v.type === "return" ? "Book returned" : "Loan renewed");
      qc.invalidateQueries({ queryKey: ["/loans"] });
      qc.invalidateQueries({ queryKey: ["/books"] });
      qc.invalidateQueries({ queryKey: ["/reservations"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <ResourcePage
        title="Book Issue & Return"
        description="Transactional copy issue, return and renewal."
        endpoint="/loans"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Issue book
          </Button>
        }
        rowAction={(r) =>
          r.status === "ACTIVE" ? (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                onClick={() => action.mutate({ id: r.id, type: "renew" })}
              >
                <RotateCcw size={15} />
                Renew
              </Button>
              <Button
                variant="ghost"
                onClick={() => action.mutate({ id: r.id, type: "return" })}
              >
                Return
              </Button>
            </div>
          ) : null
        }
        columns={[
          { label: "Book", value: (r) => <b>{r.copy.book.title}</b> },
          { label: "Member", value: (r) => r.member.fullName },
          { label: "Accession", value: (r) => r.copy.accessionNumber },
          {
            label: "Due",
            value: (r) => new Date(r.dueDate).toLocaleDateString("en-IN"),
          },
          { label: "Status", value: (r) => badge(r.status) },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Issue physical book copy"
        endpoint="/loans/issue"
        invalidate={["/loans", "/books", "/dashboard"]}
      >
        <label className={`${labelClass} ${full}`}>
          Member
          <select name="memberId" className="input mt-2" required>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
        <label className={`${labelClass} ${full}`}>
          Available copy
          <select name="copyId" className="input mt-2" required>
            <Options
              items={copies}
              label={(x) => `${x.title} · ${x.accessionNumber}`}
            />
          </select>
        </label>
      </ActionForm>
    </>
  );
}

export function ReservationsPage() {
  const [open, setOpen] = useState(false);
  const members = useItems("/members?pageSize=100");
  const books = useItems("/books?pageSize=100");
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/reservations/${id}/cancel`, json("POST")),
    onSuccess: () => {
      toast.success("Reservation cancelled");
      qc.invalidateQueries({ queryKey: ["/reservations"] });
      qc.invalidateQueries({ queryKey: ["/books"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <ResourcePage
        title="Book Reservations"
        description="Fair waiting queues for unavailable titles."
        endpoint="/reservations"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Reserve title
          </Button>
        }
        rowAction={(r) =>
          ["WAITING", "READY"].includes(r.status) ? (
            <Button variant="ghost" onClick={() => cancel.mutate(r.id)}>
              Cancel
            </Button>
          ) : null
        }
        columns={[
          { label: "Queue", value: (r) => `#${r.queueNumber}` },
          { label: "Title", value: (r) => <b>{r.book.title}</b> },
          { label: "Member", value: (r) => r.member.fullName },
          {
            label: "Created",
            value: (r) => new Date(r.createdAt).toLocaleDateString("en-IN"),
          },
          { label: "Status", value: (r) => badge(r.status) },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Reserve unavailable title"
        endpoint="/reservations"
        invalidate={["/reservations"]}
      >
        <label className={`${labelClass} ${full}`}>
          Member
          <select name="memberId" className="input mt-2" required>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
        <label className={`${labelClass} ${full}`}>
          Book title
          <select name="bookId" className="input mt-2" required>
            <Options
              items={books.filter(
                (x) => !x.copies.some((c: Item) => c.status === "AVAILABLE"),
              )}
              label={(x) => x.title}
            />
          </select>
        </label>
      </ActionForm>
    </>
  );
}

export function FinesPage() {
  const qc = useQueryClient();
  const waive = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(`/fines/${id}/waive`, json("POST", { reason })),
    onSuccess: () => {
      toast.success("Fine waived with audit reason");
      qc.invalidateQueries({ queryKey: ["/fines"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <ResourcePage
      title="Fines & Charges"
      description="Separate, auditable financial records for library charges."
      endpoint="/fines"
      rowAction={(r) =>
        ["UNPAID", "PARTIAL"].includes(r.status) ? (
          <Button
            variant="ghost"
            onClick={() => {
              const reason = window.prompt("Reason for waiver");
              if (reason) waive.mutate({ id: r.id, reason });
            }}
          >
            Waive
          </Button>
        ) : null
      }
      columns={[
        { label: "Member", value: (r) => <b>{r.member.fullName}</b> },
        { label: "Reason", value: (r) => r.reason },
        { label: "Amount", value: (r) => money(r.amount) },
        { label: "Paid", value: (r) => money(r.paidAmount) },
        { label: "Status", value: (r) => badge(r.status) },
      ]}
    />
  );
}

export function PaymentsPage() {
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const members = useItems("/members?pageSize=100");
  const invoices = useItems("/payments/invoices").filter(
    (x) => Number(x.total) > Number(x.paid) && x.status !== "VOID",
  );
  const qc = useQueryClient();
  const refund = useMutation({
    mutationFn: ({
      id,
      amount,
      reason,
    }: {
      id: string;
      amount: number;
      reason: string;
    }) => api(`/payments/${id}/refund`, json("POST", { amount, reason })),
    onSuccess: async () => {
      toast.success("Refund recorded");
      await qc.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <ResourcePage
        title="Payments & Receipts"
        description="Immutable receipts with controlled, auditable refunds."
        endpoint="/payments"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setInvoiceOpen(true)}>
              New invoice
            </Button>
            <Button onClick={() => setPaymentOpen(true)}>Record payment</Button>
          </div>
        }
        rowAction={(payment) =>
          Number(payment.amount) >
          payment.refunds.reduce(
            (sum: number, item: Item) => sum + Number(item.amount),
            0,
          ) ? (
            <Button
              variant="ghost"
              onClick={() => {
                const amount = Number(window.prompt("Refund amount"));
                if (!amount) return;
                const reason = window.prompt("Refund reason");
                if (reason) refund.mutate({ id: payment.id, amount, reason });
              }}
            >
              Refund
            </Button>
          ) : null
        }
        columns={[
          { label: "Receipt", value: (r) => <b>{r.receiptNo}</b> },
          { label: "Member", value: (r) => r.member.fullName },
          { label: "Amount", value: (r) => money(r.amount) },
          {
            label: "Refunded",
            value: (r) =>
              money(
                r.refunds.reduce(
                  (sum: number, item: Item) => sum + Number(item.amount),
                  0,
                ),
              ),
          },
          { label: "Method", value: (r) => badge(r.method) },
          {
            label: "Paid",
            value: (r) => new Date(r.paidAt).toLocaleString("en-IN"),
          },
        ]}
      />
      <ActionForm
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        title="Create invoice"
        endpoint="/payments/invoices"
        invalidate={["/payments/invoices"]}
        transform={(f) => ({
          memberId: f.get("memberId"),
          dueDate: f.get("dueDate") || undefined,
          items: [
            {
              type: f.get("type"),
              description: f.get("description"),
              quantity: 1,
              unitAmount: f.get("amount"),
            },
          ],
        })}
      >
        <label className={`${labelClass} ${full}`}>
          Member
          <select name="memberId" className="input mt-2" required>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
        <label className={labelClass}>
          Category
          <select name="type" className="input mt-2">
            <option value="SUBSCRIPTION">Subscription</option>
            <option value="OVERDUE_FINE">Overdue fine</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className={labelClass}>
          Amount
          <input
            name="amount"
            className="input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
        </label>
        <label className={`${labelClass} ${full}`}>
          Description
          <input name="description" className="input mt-2" required />
        </label>
        <label className={labelClass}>
          Due date
          <input name="dueDate" className="input mt-2" type="date" />
        </label>
      </ActionForm>
      <ActionForm
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title="Record payment"
        endpoint="/payments"
        invalidate={["/payments", "/payments/invoices", "/dashboard"]}
        transform={(f) => {
          const invoice = invoices.find((x) => x.id === f.get("invoiceId"));
          return {
            memberId: invoice?.memberId,
            invoiceId: f.get("invoiceId"),
            amount: f.get("amount"),
            method: f.get("method"),
            reference: f.get("reference") || undefined,
            idempotencyKey: crypto.randomUUID(),
          };
        }}
      >
        <label className={`${labelClass} ${full}`}>
          Outstanding invoice
          <select name="invoiceId" className="input mt-2" required>
            <Options
              items={invoices}
              label={(x) =>
                `${x.invoiceNo} · ${x.member.fullName} · ${money(Number(x.total) - Number(x.paid))}`
              }
            />
          </select>
        </label>
        <label className={labelClass}>
          Amount
          <input
            name="amount"
            className="input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
        </label>
        <label className={labelClass}>
          Method
          <select name="method" className="input mt-2">
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </label>
        <label className={`${labelClass} ${full}`}>
          Reference
          <input name="reference" className="input mt-2" />
        </label>
      </ActionForm>
    </>
  );
}

export function ExpensesPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const fields = (expense?: Item) => (
    <>
      <label className={labelClass}>
        Category
        <select
          name="category"
          className="input mt-2"
          defaultValue={expense?.category ?? "Rent"}
        >
          <option>Rent</option>
          <option>Electricity</option>
          <option>Internet</option>
          <option>Maintenance</option>
          <option>Book Purchases</option>
          <option>Miscellaneous</option>
        </select>
      </label>
      <label className={labelClass}>
        Amount
        <input
          name="amount"
          className="input mt-2"
          type="number"
          min="0.01"
          step="0.01"
          defaultValue={expense?.amount ?? ""}
          required
        />
      </label>
      <label className={`${labelClass} ${full}`}>
        Description
        <input
          name="description"
          className="input mt-2"
          defaultValue={expense?.description ?? ""}
          required
        />
      </label>
      <label className={labelClass}>
        Date
        <input
          name="expenseDate"
          className="input mt-2"
          type="date"
          defaultValue={expense?.expenseDate?.slice(0, 10) ?? today()}
          required
        />
      </label>
      <label className={labelClass}>
        Method
        <select
          name="method"
          className="input mt-2"
          defaultValue={expense?.method ?? "CASH"}
        >
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="ONLINE_GATEWAY">Online gateway</option>
        </select>
      </label>
      <label className={`${labelClass} ${full}`}>
        Reference
        <input
          name="reference"
          className="input mt-2"
          defaultValue={expense?.reference ?? ""}
        />
      </label>
      <label className={`${labelClass} ${full}`}>
        Notes
        <textarea
          name="notes"
          className="input mt-2"
          rows={2}
          defaultValue={expense?.notes ?? ""}
        />
      </label>
    </>
  );
  const payload = (f: FormData) => ({
    category: f.get("category"),
    amount: f.get("amount"),
    description: f.get("description"),
    expenseDate: f.get("expenseDate"),
    method: f.get("method"),
    reference: f.get("reference") || null,
    notes: f.get("notes") || null,
  });
  return (
    <>
      <ResourcePage
        title="Expenses"
        description="Operational spending, separate from library collections."
        endpoint="/expenses"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Add expense
          </Button>
        }
        rowAction={(expense) => (
          <Button variant="ghost" onClick={() => setEditing(expense)}>
            <Pencil size={15} />
            Edit
          </Button>
        )}
        columns={[
          {
            label: "Date",
            value: (r) => new Date(r.expenseDate).toLocaleDateString("en-IN"),
          },
          { label: "Category", value: (r) => badge(r.category) },
          { label: "Description", value: (r) => <b>{r.description}</b> },
          { label: "Amount", value: (r) => money(r.amount) },
          { label: "Method", value: (r) => r.method.replaceAll("_", " ") },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Add expense"
        endpoint="/expenses"
        invalidate={["/expenses", "/dashboard"]}
        transform={payload}
      >
        {fields()}
      </ActionForm>
      {editing && (
        <ActionForm
          open
          onClose={() => setEditing(null)}
          title="Edit expense"
          endpoint={`/expenses/${editing.id}`}
          method="PATCH"
          invalidate={["/expenses", "/dashboard"]}
          transform={payload}
        >
          {fields(editing)}
        </ActionForm>
      )}
    </>
  );
}

export function NotificationsPage() {
  const [open, setOpen] = useState(false);
  const members = useItems("/members?pageSize=100");
  const qc = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, json("PATCH")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/notifications"] }),
  });
  return (
    <>
      <ResourcePage
        title="Notifications"
        description="In-app reminders and administrator announcements."
        endpoint="/notifications"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            Announcement
          </Button>
        }
        rowAction={(r) =>
          r.status === "UNREAD" ? (
            <Button variant="ghost" onClick={() => read.mutate(r.id)}>
              <Check size={15} />
              Mark read
            </Button>
          ) : null
        }
        columns={[
          { label: "Event", value: (r) => <b>{r.title}</b> },
          { label: "Message", value: (r) => r.message },
          { label: "Member", value: (r) => r.member?.fullName || "System" },
          { label: "Status", value: (r) => badge(r.status) },
          {
            label: "Created",
            value: (r) => new Date(r.createdAt).toLocaleDateString("en-IN"),
          },
        ]}
      />
      <ActionForm
        open={open}
        onClose={() => setOpen(false)}
        title="Create announcement"
        endpoint="/notifications"
        invalidate={["/notifications"]}
        transform={(f) => ({
          title: f.get("title"),
          message: f.get("message"),
          ...(f.get("memberId") ? { memberId: f.get("memberId") } : {}),
        })}
      >
        <label className={`${labelClass} ${full}`}>
          Title
          <input name="title" className="input mt-2" required />
        </label>
        <label className={`${labelClass} ${full}`}>
          Message
          <textarea name="message" className="input mt-2" rows={4} required />
        </label>
        <label className={`${labelClass} ${full}`}>
          Member (optional)
          <select name="memberId" className="input mt-2">
            <option value="">General announcement</option>
            <Options
              items={members}
              label={(x) => `${x.publicId} · ${x.fullName}`}
            />
          </select>
        </label>
      </ActionForm>
    </>
  );
}
