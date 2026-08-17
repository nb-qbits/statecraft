"use client";

import { useState, useEffect, useCallback } from "react";
import { loadAllBills } from "@/lib/docket-data";
import type { DocketBill, DocketTask } from "@/lib/docket-types";
import { STATUS_META, daysUntilLabel, provenanceSummary } from "@/lib/docket-types";
import { TaskCard } from "@/components/docket/task-card";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Build the grid of day cells for a given month (including leading/trailing blanks). */
function buildMonthGrid(year: number, monthIndex: number): (number | null)[] {
  const firstDay = new Date(year, monthIndex, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Get the date key for a task (prefer adjustedDate, then due). */
function taskDateKey(task: DocketTask): string | null {
  return task.adjustedDate ?? task.due ?? null;
}

/** Abbreviate an actor name to 3 uppercase characters. */
function actorAbbrev(actor: string | null): string {
  if (!actor) return "---";
  const skip = new Set(["of", "the", "and", "for"]);
  const words = actor
    .replace(/[.&]/g, "")
    .split(" ")
    .filter((w) => w && !skip.has(w.toLowerCase()));
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Arrow icons                                                        */
/* ------------------------------------------------------------------ */

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M11 4L6 9L11 14" stroke="#16233F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M7 4L12 9L7 14" stroke="#16233F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Day cell                                                           */
/* ------------------------------------------------------------------ */

interface DayCellProps {
  day: number | null;
  dateKey: string | null;
  isToday: boolean;
  isSelected: boolean;
  tasks: DocketTask[];
  onSelect: (dateKey: string) => void;
}

function DayCell({ day, dateKey, isToday, isSelected, tasks, onSelect }: DayCellProps) {
  if (day === null) {
    return <div style={{ minHeight: "80px", borderBottom: "1px solid #E5E5EA", borderRight: "1px solid #E5E5EA" }} />;
  }

  return (
    <button
      type="button"
      onClick={() => dateKey && onSelect(dateKey)}
      style={{
        minHeight: "80px",
        borderBottom: "1px solid #E5E5EA",
        borderRight: "1px solid #E5E5EA",
        background: isSelected ? "#F0EDE5" : "white",
        padding: "6px 8px",
        cursor: "pointer",
        border: "none",
        borderBottomStyle: "solid",
        borderBottomWidth: "1px",
        borderBottomColor: "#E5E5EA",
        borderRightStyle: "solid",
        borderRightWidth: "1px",
        borderRightColor: "#E5E5EA",
        textAlign: "left",
        verticalAlign: "top",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        position: "relative",
      }}
    >
      {/* Day number */}
      <span
        style={{
          fontSize: "13px",
          fontWeight: isToday ? 700 : 500,
          color: isToday ? "#C8983E" : "#1D1D1F",
          width: "24px",
          height: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: isToday ? "2px solid #C8983E" : "none",
        }}
      >
        {day}
      </span>

      {/* Desktop: small pills (hidden on mobile) */}
      <div className="hidden md:flex" style={{ flexDirection: "column", gap: "2px" }}>
        {tasks.slice(0, 4).map((t, i) => (
          <div
            key={t.anchorId + i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "3px",
              fontSize: "10px",
              fontWeight: 600,
              color: STATUS_META[t.status].color,
              lineHeight: 1.2,
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: STATUS_META[t.status].dot,
                flexShrink: 0,
              }}
            />
            <span className="truncate" style={{ maxWidth: "48px" }}>
              {actorAbbrev(t.actor)}
            </span>
          </div>
        ))}
        {tasks.length > 4 && (
          <span style={{ fontSize: "9px", color: "#86868B" }}>+{tasks.length - 4}</span>
        )}
      </div>

      {/* Mobile: colored dots only */}
      <div className="flex md:hidden" style={{ gap: "3px", flexWrap: "wrap" }}>
        {tasks.slice(0, 4).map((t, i) => (
          <span
            key={t.anchorId + i}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: STATUS_META[t.status].dot,
            }}
          />
        ))}
        {tasks.length > 4 && (
          <span style={{ fontSize: "9px", color: "#86868B" }}>+{tasks.length - 4}</span>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Day detail panel                                                    */
/* ------------------------------------------------------------------ */

function CompactTaskCard({ task }: { task: DocketTask }) {
  const meta = STATUS_META[task.status];
  const daysLabel = task.due ? daysUntilLabel(task.due, task.status) : null;

  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid #EFEFF1",
      }}
    >
      {/* Bill context */}
      {task.billNumber && (
        <div
          style={{
            fontSize: "10.5px",
            color: "#86868B",
            marginBottom: "4px",
          }}
        >
          {task.billNumber}
        </div>
      )}

      {/* Citation + status row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "6px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            color: "#6E6E73",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {task.citation}
        </div>
        <span
          style={{
            fontSize: "10.5px",
            fontWeight: 600,
            color: meta.color,
            backgroundColor: meta.bg,
            padding: "2px 8px",
            borderRadius: "9999px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {meta.label}
        </span>
      </div>

      {/* Obligation text */}
      <div
        style={{
          fontSize: "12.5px",
          color: "#1D1D1F",
          lineHeight: 1.45,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical" as const,
          overflow: "hidden",
          marginBottom: "8px",
        }}
      >
        {task.obligation}
      </div>

      {/* Date + countdown */}
      {task.due && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "6px",
            fontSize: "12px",
          }}
        >
          <span style={{ fontWeight: 600, color: "#1D1D1F" }}>
            {formatDate(task.due)}
          </span>
          {daysLabel && (
            <span style={{ fontSize: "11px", color: meta.color, fontWeight: 500 }}>
              {daysLabel}
            </span>
          )}
        </div>
      )}

      {/* Provenance summary */}
      <div style={{ fontSize: "10.5px", color: "#AEAEB2", marginTop: "4px" }}>
        {provenanceSummary(task)}
      </div>
    </div>
  );
}

function DayDetailPanel({
  dateKey,
  tasks,
}: {
  dateKey: string | null;
  tasks: DocketTask[];
}) {
  if (!dateKey) {
    return (
      <div
        style={{
          padding: "24px 20px",
          color: "#AEAEB2",
          fontSize: "13px",
          textAlign: "center",
        }}
      >
        Select a day to see its deadlines.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          padding: "16px 16px 8px",
          fontSize: "15px",
          fontWeight: 600,
          color: "#16233F",
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'SF Pro Display','Public Sans',sans-serif",
          letterSpacing: "-0.02em",
        }}
      >
        {formatDate(dateKey)}
      </div>
      {tasks.length === 0 ? (
        <div
          style={{
            padding: "20px 16px",
            color: "#AEAEB2",
            fontSize: "13px",
          }}
        >
          No deadlines on this day.
        </div>
      ) : (
        tasks.map((t) => <CompactTaskCard key={t.anchorId} task={t} />)
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function CalendarPage() {
  const [bills, setBills] = useState<DocketBill[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonthIndex, setCalMonthIndex] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [billFilter, setBillFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    const loaded = await loadAllBills();
    setBills(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* ---- derived data ---- */

  const filteredBills =
    billFilter === "all" ? bills : bills.filter((b) => b.dvId === billFilter);

  const allTasks = filteredBills.flatMap((b) => b.tasks);

  // Index tasks by date for fast lookup
  const tasksByDate = new Map<string, DocketTask[]>();
  for (const t of allTasks) {
    const dk = taskDateKey(t);
    if (!dk) continue;
    const list = tasksByDate.get(dk) ?? [];
    list.push(t);
    tasksByDate.set(dk, list);
  }

  const todayKey = toDateKey(now);
  const grid = buildMonthGrid(calYear, calMonthIndex);
  const selectedTasks = selectedDate ? (tasksByDate.get(selectedDate) ?? []) : [];

  const unresolvedTasks = allTasks.filter((t) => t.determination === "unresolved");

  /* ---- navigation ---- */

  function prevMonth() {
    if (calMonthIndex === 0) {
      setCalYear((y) => y - 1);
      setCalMonthIndex(11);
    } else {
      setCalMonthIndex((m) => m - 1);
    }
    setSelectedDate(null);
  }

  function nextMonth() {
    if (calMonthIndex === 11) {
      setCalYear((y) => y + 1);
      setCalMonthIndex(0);
    } else {
      setCalMonthIndex((m) => m + 1);
    }
    setSelectedDate(null);
  }

  /* ---- today string ---- */

  const todayLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ---- render ---- */

  return (
    <>
      {/* Top bar */}
      <div
        className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-10 md:py-5"
        style={{ borderColor: "#E5E5EA" }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "25px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Calendar
        </div>
        <div style={{ fontSize: "12.5px", color: "#6E6E73", fontFamily: "var(--font-body)" }}>
          Today &mdash; {todayLabel}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 md:p-8">
        {loading ? (
          <div className="py-16 text-center text-sm" style={{ color: "#AEAEB2" }}>
            Loading calendar...
          </div>
        ) : bills.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: "#AEAEB2" }}>
            No bills tracked yet. Add a bill to see deadlines on your calendar.
          </div>
        ) : (
          <>
            {/* Bill filter chips */}
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBillFilter("all")}
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  padding: "5px 14px",
                  borderRadius: "9999px",
                  border: billFilter === "all" ? "none" : "1px solid #E5E5EA",
                  cursor: "pointer",
                  backgroundColor: billFilter === "all" ? "#16233F" : "#FFFFFF",
                  color: billFilter === "all" ? "#F5F2E8" : "#3A3A3C",
                  fontFamily: "var(--font-body)",
                  transition: "all 0.15s ease",
                }}
              >
                All bills
              </button>
              {bills.map((b) => (
                <button
                  key={b.dvId}
                  type="button"
                  onClick={() => setBillFilter(b.dvId)}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 600,
                    padding: "5px 14px",
                    borderRadius: "9999px",
                    border: billFilter === b.dvId ? "none" : "1px solid #E5E5EA",
                    cursor: "pointer",
                    backgroundColor: billFilter === b.dvId ? "#16233F" : "#FFFFFF",
                    color: billFilter === b.dvId ? "#F5F2E8" : "#3A3A3C",
                    fontFamily: "var(--font-body)",
                    transition: "all 0.15s ease",
                  }}
                >
                  {b.number}
                </button>
              ))}
            </div>

            {/* Calendar nav row */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label="Previous month"
                  style={{
                    background: "none",
                    border: "1px solid #E5E5EA",
                    borderRadius: "8px",
                    padding: "4px 6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <ChevronLeft />
                </button>
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "#16233F",
                    fontFamily:
                      "-apple-system,BlinkMacSystemFont,'SF Pro Display','Public Sans',sans-serif",
                    letterSpacing: "-0.02em",
                    minWidth: "180px",
                    textAlign: "center",
                  }}
                >
                  {monthLabel(calYear, calMonthIndex)}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label="Next month"
                  style={{
                    background: "none",
                    border: "1px solid #E5E5EA",
                    borderRadius: "8px",
                    padding: "4px 6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <ChevronRight />
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  alert(
                    "Calendar sync is not yet available. You can export ICS files from individual bill pages.",
                  )
                }
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  padding: "6px 16px",
                  borderRadius: "8px",
                  border: "1px solid #E5E5EA",
                  background: "white",
                  color: "#16233F",
                  cursor: "pointer",
                }}
              >
                Sync to calendar
              </button>
            </div>

            {/* Calendar grid + detail panel */}
            <div className="flex flex-col md:flex-row gap-0">
              {/* Grid */}
              <div
                className="flex-1 min-w-0 rounded-[12px] overflow-hidden border"
                style={{ borderColor: "#D8D8DC", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
              >
                {/* Weekday header */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    borderBottom: "1px solid #E5E5EA",
                  }}
                >
                  {weekDays.map((wd) => (
                    <div
                      key={wd}
                      style={{
                        padding: "8px 0",
                        textAlign: "center",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        color: "#86868B",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {wd}
                    </div>
                  ))}
                </div>

                {/* Day grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                  }}
                >
                  {grid.map((day, i) => {
                    const dateKey =
                      day !== null
                        ? `${calYear}-${String(calMonthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                        : null;
                    const tasks = dateKey ? (tasksByDate.get(dateKey) ?? []) : [];
                    const isToday = dateKey === todayKey;
                    const isSelected = dateKey !== null && dateKey === selectedDate;

                    return (
                      <DayCell
                        key={i}
                        day={day}
                        dateKey={dateKey}
                        isToday={isToday}
                        isSelected={isSelected}
                        tasks={tasks}
                        onSelect={setSelectedDate}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Day detail panel */}
              <div
                className="w-full md:w-[280px] md:ml-0 border-t md:border-t-0 md:border-l rounded-b-[12px] md:rounded-bl-none md:rounded-r-[12px]"
                style={{
                  borderColor: "#E5E5EA",
                  background: "white",
                  minHeight: "200px",
                }}
              >
                <DayDetailPanel dateKey={selectedDate} tasks={selectedTasks} />
              </div>
            </div>

            {/* Needs your input section */}
            {unresolvedTasks.length > 0 && (
              <div className="mt-8">
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#16233F",
                    marginBottom: "4px",
                  }}
                >
                  Needs your input
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "#86868B",
                    marginBottom: "12px",
                  }}
                >
                  These obligations have no date because information is missing
                  from the source document.
                </div>
                <div
                  className="rounded-[12px] border overflow-hidden"
                  style={{ borderColor: "#D8D8DC", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
                >
                  {unresolvedTasks.map((t) => (
                    <TaskCard key={t.anchorId} task={t} showBillContext />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
