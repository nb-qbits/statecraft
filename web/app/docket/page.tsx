"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { loadAllBills, removeStoredBill } from "@/lib/docket-data";
import type { DocketBill, DocketTask, StatusCounts } from "@/lib/docket-types";
import {
  countStatuses,
  STATUS_META,
  getAgencyInitials,
  daysUntilLabel,
} from "@/lib/docket-types";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface AgencyInfo {
  name: string;
  tasks: DocketTask[];
  bills: Set<string>;
  counts: StatusCounts;
  urgency: string;
  ringColor: string;
  countdownText: string;
}

function buildAgencyCards(tasks: DocketTask[]): AgencyInfo[] {
  const byAgency = new Map<string, DocketTask[]>();
  for (const t of tasks) {
    const actor = t.actor || "Unassigned";
    const list = byAgency.get(actor) ?? [];
    list.push(t);
    byAgency.set(actor, list);
  }

  return Array.from(byAgency.entries())
    .map(([name, agencyTasks]) => {
      const counts = countStatuses(agencyTasks);
      const bills = new Set(agencyTasks.map((t) => t.billDvId));

      let urgency: string;
      let ringColor: string;
      let countdownText: string;

      if (counts.overdue > 0) {
        urgency = "overdue";
        ringColor = STATUS_META.overdue.color;
        const overdueTasks = agencyTasks
          .filter((t) => t.status === "overdue" && t.due)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
        const oldest = overdueTasks[0];
        countdownText = oldest
          ? daysUntilLabel(oldest.due, "overdue")
          : `${counts.overdue} overdue`;
      } else if (counts.needs_input > 0) {
        urgency = "needs_input";
        ringColor = STATUS_META.needs_input.color;
        countdownText = `${counts.needs_input} need${counts.needs_input === 1 ? "s" : ""} input`;
      } else if (counts.due_soon > 0) {
        urgency = "due_soon";
        ringColor = STATUS_META.due_soon.color;
        const soonTasks = agencyTasks
          .filter((t) => t.status === "due_soon" && t.due)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
        countdownText = soonTasks[0]
          ? daysUntilLabel(soonTasks[0].due, "due_soon")
          : "Due soon";
      } else if (counts.upcoming > 0) {
        urgency = "upcoming";
        ringColor = STATUS_META.upcoming.color;
        const upTasks = agencyTasks
          .filter((t) => t.status === "upcoming" && t.due)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
        countdownText = upTasks[0]
          ? daysUntilLabel(upTasks[0].due, "upcoming")
          : "Upcoming";
      } else {
        urgency = "completed";
        ringColor = STATUS_META.completed.color;
        countdownText = "All caught up";
      }

      return { name, tasks: agencyTasks, bills, counts, urgency, ringColor, countdownText };
    })
    .sort((a, b) => {
      const order = ["overdue", "needs_input", "due_soon", "upcoming", "completed"];
      return order.indexOf(a.urgency) - order.indexOf(b.urgency);
    });
}

function AgencyCard({ agency, selected, onSelect }: { agency: AgencyInfo; selected: boolean; onSelect: () => void }) {
  const completedRatio =
    agency.counts.total > 0
      ? agency.counts.completed / agency.counts.total
      : 0;
  const circumference = 2 * Math.PI * 24;
  const dashoffset = circumference * (1 - completedRatio);
  const initials = getAgencyInitials(agency.name);

  return (
    <div
      onClick={onSelect}
      className="flex cursor-pointer items-center gap-3.5 rounded-[12px] border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        borderColor: selected ? agency.ringColor : "#D8D8DC",
        padding: "16px",
        boxShadow: selected ? `0 0 0 1px ${agency.ringColor}, 0 2px 8px rgba(0,0,0,0.10)` : "0 1px 4px rgba(0,0,0,0.07)",
      }}
    >
      <svg width="52" height="52" viewBox="0 0 60 60" className="flex-shrink-0">
        <circle cx="30" cy="30" r="24" fill="none" stroke={`${agency.ringColor}25`} strokeWidth="5" />
        <circle
          cx="30" cy="30" r="24" fill="none"
          stroke={agency.ringColor} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={dashoffset}
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(.16,1,.3,1)" }}
        />
        <text
          x="30" y="34" textAnchor="middle" fontSize="12" fontWeight="700"
          fill="#16233F" fontFamily="-apple-system, BlinkMacSystemFont, 'Public Sans', sans-serif"
        >
          {initials}
        </text>
      </svg>
      <div className="min-w-0">
        <div
          className="truncate text-[15px] font-semibold leading-tight"
          style={{ color: "#1D1D1F" }}
        >
          {agency.name}
        </div>
        <div className="my-0.5 text-[13px]" style={{ color: "#86868B" }}>
          {agency.tasks.length} task{agency.tasks.length !== 1 ? "s" : ""} · {agency.bills.size} bill(s)
        </div>
        <div className="text-[13px] font-bold" style={{ color: agency.ringColor }}>
          {agency.countdownText}
        </div>
      </div>
    </div>
  );
}

function BillCard({ bill, onRemove }: { bill: DocketBill; onRemove: (dvId: string) => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const counts = countStatuses(bill.tasks);
  const total = bill.tasks.length || 1;
  const overdPct = (counts.overdue / total) * 100;
  const needsPct = (counts.needs_input / total) * 100;
  const soonPct = (counts.due_soon / total) * 100;
  const upPct = (counts.upcoming / total) * 100;
  const donePct = (counts.completed / total) * 100;

  const pending = bill.tasks
    .filter((t) => t.status !== "completed" && t.status !== "needs_input" && t.due)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const nextDue = pending[0]?.due ? formatDate(pending[0].due) : "—";

  return (
    <div className="relative">
      <Link href={`/docket/bill/${bill.dvId}`} className="block no-underline">
        <div
          className="cursor-pointer rounded-[12px] border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
          style={{ borderColor: "#D8D8DC", padding: "22px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
        >
          <div className="flex items-start justify-between">
            <div style={{ fontSize: "13px", letterSpacing: "0.03em", color: "#6E6E73", marginBottom: "6px", fontFamily: "var(--font-body)" }}>
              {bill.number} · {bill.session}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "22px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#16233F",
              lineHeight: 1.25,
              marginBottom: "10px",
            }}
          >
            {bill.title}
          </div>
          <div className="mb-3 flex h-[7px] overflow-hidden rounded" style={{ background: "#EDEDF0" }}>
            <div style={{ width: `${overdPct}%`, background: "#B8452F" }} />
            <div style={{ width: `${needsPct}%`, background: "#8377B0" }} />
            <div style={{ width: `${soonPct}%`, background: "#C79A44" }} />
            <div style={{ width: `${upPct}%`, background: "#4C6D96" }} />
            <div style={{ width: `${donePct}%`, background: "#5C8B71" }} />
          </div>
          <div className="flex justify-between text-[14px]" style={{ color: "#6E6E73" }}>
            <span>{bill.tasks.length} tracked tasks</span>
            <span>Next due {nextDue}</span>
          </div>
        </div>
      </Link>
      {!confirmRemove ? (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmRemove(true); }}
          className="absolute right-2 top-2 flex h-[26px] w-[26px] items-center justify-center rounded-full opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
          style={{ background: "rgba(0,0,0,0.06)", color: "#86868B", border: "none", cursor: "pointer" }}
          title="Remove bill"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-[12px]"
          style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(2px)", zIndex: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 text-[14px] font-medium" style={{ color: "#1D1D1F" }}>
            Remove {bill.title}?
          </div>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(bill.dvId); }}
              className="rounded-[8px] px-4 py-1.5 text-[14px] font-semibold"
              style={{ background: "#B8452F", color: "#FFFFFF", border: "none", cursor: "pointer" }}
            >
              Remove
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmRemove(false); }}
              className="rounded-[8px] px-4 py-1.5 text-[14px] font-medium"
              style={{ color: "#6E6E73", background: "none", border: "1px solid #D8D8DC", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div
      className="rounded-[12px] border bg-white"
      style={{
        borderColor: "#D8D8DC",
        padding: "18px 20px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 500, color: "#6E6E73", marginBottom: "8px", fontFamily: "var(--font-body)" }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "26px",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          color: color ?? "#16233F",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [bills, setBills] = useState<DocketBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [billFilter, setBillFilter] = useState<string>("all");
  const [selectedAgency, setSelectedAgency] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const loaded = await loadAllBills();
    setBills(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }));
  }, []);

  const allTasks =
    billFilter === "all"
      ? bills.flatMap((b) => b.tasks)
      : bills.filter((b) => b.dvId === billFilter).flatMap((b) => b.tasks);
  const counts = countStatuses(allTasks);
  const agencies = buildAgencyCards(allTasks);
  const billCount = bills.length;
  const billLimit = 10;

  const handleRemoveBill = (dvId: string) => {
    removeStoredBill(dvId);
    setBills((prev) => prev.filter((b) => b.dvId !== dvId));
    if (billFilter === dvId) setBillFilter("all");
  };

  const hasBills = bills.length > 0;

  return (
    <>
      <div
        className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-10 md:py-5"
        style={{ borderColor: "#E5E5EA" }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "30px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Dashboard
        </div>
        <div className="text-[14px]" style={{ color: "#6E6E73" }}>
          {today}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 md:p-8">
        {loading ? (
          <div className="py-16 text-center text-sm" style={{ color: "#AEAEB2" }}>
            Loading your bills...
          </div>
        ) : !hasBills ? (
          <div className="py-16 text-center" style={{ color: "#AEAEB2" }}>
            <div className="mb-3 text-[15px]">No bills tracked yet.</div>
            <Link
              href="/docket/add"
              className="text-sm font-medium no-underline"
              style={{ color: "#3C5A82" }}
            >
              Add your first bill →
            </Link>
          </div>
        ) : (
          <>
            {/* Bill filter pills */}
            <div className="mb-6 flex items-center gap-3">
              <span className="text-[14px] font-medium" style={{ color: "#6E6E73" }}>
                Show:
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setBillFilter("all")}
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "6px 16px",
                    borderRadius: "9999px",
                    border: billFilter === "all" ? "none" : "1px solid #E5E5EA",
                    backgroundColor: billFilter === "all" ? "#16233F" : "#FFFFFF",
                    color: billFilter === "all" ? "#F5F2E8" : "#3A3A3C",
                    cursor: "pointer",
                  }}
                >
                  All bills
                </button>
                {bills.map((b) => (
                  <button
                    key={b.dvId}
                    onClick={() => setBillFilter(b.dvId)}
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      padding: "6px 16px",
                      borderRadius: "9999px",
                      border: billFilter === b.dvId ? "none" : "1px solid #E5E5EA",
                      backgroundColor: billFilter === b.dvId ? "#16233F" : "#FFFFFF",
                      color: billFilter === b.dvId ? "#F5F2E8" : "#3A3A3C",
                      cursor: "pointer",
                    }}
                  >
                    {b.number}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="mb-8 grid gap-3.5"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              }}
            >
              <StatCard
                label="Bills tracked"
                value={
                  <span>
                    {billCount}
                    <span style={{ fontSize: "14px", fontWeight: 400, color: "#86868B" }}>
                      {" "}/{billLimit}
                    </span>
                  </span>
                }
              />
              <StatCard label="Agencies" value={agencies.length} />
              <StatCard label="Total tasks" value={counts.total} />
              <StatCard
                label="Overdue"
                value={counts.overdue}
                color="#A8442C"
              />
              <StatCard
                label="Needs input"
                value={counts.needs_input}
                color="#5B5B8C"
              />
              <StatCard
                label="Due within 21d"
                value={counts.due_soon}
                color="#A67326"
              />
              <StatCard
                label="Completed"
                value={counts.completed}
                color="#3F6B54"
              />
            </div>

            {agencies.length > 0 && (
              <div className="mb-8">
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#16233F",
                    fontFamily: "var(--font-heading)",
                    letterSpacing: "-0.02em",
                    marginBottom: "16px",
                  }}
                >
                  Who&apos;s accountable
                </div>
                <div
                  className="grid gap-3.5"
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                  }}
                >
                  {agencies.map((ag) => (
                    <AgencyCard
                      key={ag.name}
                      agency={ag}
                      selected={selectedAgency === ag.name}
                      onSelect={() => setSelectedAgency(selectedAgency === ag.name ? null : ag.name)}
                    />
                  ))}
                </div>

                {selectedAgency && (() => {
                  const ag = agencies.find((a) => a.name === selectedAgency);
                  if (!ag) return null;
                  const sorted = [...ag.tasks].sort((a, b) => {
                    const order: Record<string, number> = { overdue: 0, needs_input: 1, due_soon: 2, upcoming: 3, completed: 4 };
                    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
                  });
                  return (
                    <div
                      className="mt-4 overflow-hidden rounded-[12px] border"
                      style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
                    >
                      <div
                        className="flex items-center justify-between bg-white px-5 py-3"
                        style={{ borderBottom: "1px solid #EFEFF1" }}
                      >
                        <div className="text-[15px] font-semibold" style={{ color: "#16233F" }}>
                          {ag.name} — {ag.tasks.length} task{ag.tasks.length !== 1 ? "s" : ""}
                        </div>
                        <button
                          onClick={() => setSelectedAgency(null)}
                          className="text-[13px]"
                          style={{ color: "#86868B", cursor: "pointer", background: "none", border: "none" }}
                        >
                          Close
                        </button>
                      </div>
                      {sorted.map((task) => {
                        const meta = STATUS_META[task.status];
                        return (
                          <Link
                            key={task.anchorId}
                            href={`/docket/bill/${task.billDvId}`}
                            className="block no-underline"
                          >
                            <div
                              className="flex items-center gap-4 bg-white px-5 py-3.5 transition-colors hover:bg-[#FAFAFA]"
                              style={{ borderBottom: "1px solid #EFEFF1" }}
                            >
                              <div
                                className="h-[8px] w-[8px] flex-shrink-0 rounded-full"
                                style={{ backgroundColor: meta.dot }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-[15px] leading-snug" style={{ color: "#1D1D1F" }}>
                                  {task.obligation}
                                </div>
                                <div className="mt-0.5 text-[13px]" style={{ color: "#86868B" }}>
                                  {task.billNumber} · {task.citation}
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-3">
                                {task.due && (
                                  <span className="text-[16px] font-semibold" style={{ color: "#1D1D1F" }}>
                                    {formatDate(task.due)}
                                  </span>
                                )}
                                <span
                                  className="rounded-full px-2 py-0.5 text-[12px] font-semibold"
                                  style={{ color: meta.color, backgroundColor: meta.bg }}
                                >
                                  {meta.label}
                                </span>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            <div
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#16233F",
                fontFamily: "var(--font-heading)",
                letterSpacing: "-0.02em",
                marginBottom: "16px",
              }}
            >
              Your bills
            </div>
            <div
              className="grid gap-[18px]"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              }}
            >
              {bills
                .filter((b) => billFilter === "all" || b.dvId === billFilter)
                .map((bill) => (
                  <BillCard key={bill.dvId} bill={bill} onRemove={handleRemoveBill} />
                ))}
              {billCount < billLimit && (
                <Link href="/docket/add" className="block no-underline">
                  <div
                    className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-[12px] p-6 text-center"
                    style={{ border: "1.5px dashed #C9BF9E", color: "#6E6E73" }}
                  >
                    <svg
                      width="22" height="22" viewBox="0 0 24 24"
                      fill="none" stroke="#6E6E73" strokeWidth="2"
                      className="mb-2"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    <div className="text-[15px] font-medium">Add a bill</div>
                    <div className="mt-0.5 text-[13px]">
                      {billLimit - billCount} of {billLimit} slots remaining
                    </div>
                  </div>
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
