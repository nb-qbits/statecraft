"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { fetchFindings, supplyInput, streamAnalysis, editRecordDate, fetchCalendarSyncStatus, syncCalendar, fetchUserInfo } from "@/lib/api";
import { formatActorDisplay } from "@/lib/format";
import type { FindingsResponse } from "@/lib/api";
import { findingToDocketTask, countStatuses, STATUS_META, daysUntilLabel, provenanceFor, provenanceSummary, getAgencyInitials } from "@/lib/docket-types";
import type { DocketTask, TaskStatus } from "@/lib/docket-types";
import { TaskCard } from "@/components/docket/task-card";
import { addStoredBill } from "@/lib/docket-data";

type View = "list" | "timeline";
type StatusFilter = TaskStatus | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "needs_input", label: "Needs input" },
  { key: "due_soon", label: "Due soon" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ROW_TINTS = [
  "rgba(60,90,130,0.035)",
  "rgba(200,152,62,0.03)",
  "rgba(63,107,84,0.035)",
  "rgba(91,91,140,0.03)",
  "rgba(184,69,47,0.025)",
];

function MarkerGlyph({ status, size }: { status: TaskStatus; size: number }) {
  const meta = STATUS_META[status];
  const c = meta.dot;
  if (status === "completed") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill={c} />
        <path d="M6 10.5L9 13.5L14 7.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (status === "overdue") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        <path d="M10 1.5L19 17.5H1L10 1.5Z" fill={c} stroke={c} strokeWidth="0.5" strokeLinejoin="round" />
        <text x="10" y="14.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">!</text>
      </svg>
    );
  }
  if (status === "needs_input") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke={c} strokeWidth="2.5" strokeDasharray="4 3" />
        <text x="10" y="14" textAnchor="middle" fontSize="11" fontWeight="700" fill={c}>?</text>
      </svg>
    );
  }
  if (status === "due_soon") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill={c} />
        <circle cx="10" cy="10" r="4" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="8" fill="none" stroke={c} strokeWidth="2.5" />
    </svg>
  );
}

function TaskPopover({
  task,
  onClose,
  onAddDate,
  onViewInList,
  caretSide = "bottom",
  caretOffset = 185,
}: {
  task: DocketTask;
  onClose: () => void;
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
  onViewInList: () => void;
  caretSide?: "top" | "bottom";
  caretOffset?: number;
}) {
  const meta = STATUS_META[task.status];
  const actorDisplay = formatActorDisplay(task.actor);
  const initials = actorDisplay.isPlaceholder ? "?" : getAgencyInitials(actorDisplay.text);
  const relLabel = daysUntilLabel(task.due, task.status);
  const [provOpen, setProvOpen] = useState(false);
  const provRows = provenanceFor(task);
  const provSummaryText = provenanceSummary(task);
  const [dateFormOpen, setDateFormOpen] = useState(false);
  const [dateValue, setDateValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveDate() {
    if (!dateValue || !onAddDate) return;
    setSaving(true);
    try {
      await onAddDate(task.anchorId, dateValue);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      {/* Caret pointing toward the marker */}
      <div
        style={{
          position: "absolute",
          [caretSide === "bottom" ? "bottom" : "top"]: "-6px",
          left: `${caretOffset}px`,
          transform: "translateX(-6px)",
          width: "12px",
          height: "12px",
          backgroundColor: caretSide === "bottom" ? "#FAFAFB" : meta.bg,
          border: "1px solid #E5E5EA",
          borderTop: caretSide === "bottom" ? "none" : undefined,
          borderLeft: caretSide === "bottom" ? "none" : undefined,
          borderBottom: caretSide === "top" ? "none" : undefined,
          borderRight: caretSide === "top" ? "none" : undefined,
          rotate: "45deg",
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 2,
          width: "370px",
          backgroundColor: "#FFFFFF",
          borderRadius: "14px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.08)",
          border: "1px solid #E5E5EA",
          overflow: "hidden",
        }}
      >
      {/* Status accent header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          backgroundColor: meta.bg,
          borderBottom: `2px solid ${meta.dot}30`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MarkerGlyph status={task.status} size={16} />
          <span style={{ fontSize: "13px", fontWeight: 700, color: meta.color }}>
            {meta.label}
          </span>
          {relLabel && (
            <span style={{ fontSize: "13px", color: meta.color, fontWeight: 500, opacity: 0.8 }}>
              &middot; {relLabel}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            color: meta.color,
            fontSize: "18px",
            lineHeight: 1,
            opacity: 0.6,
          }}
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 18px 14px" }}>
        {/* Full obligation */}
        <div style={{ fontSize: "15px", color: "#1D1D1F", lineHeight: 1.5, marginBottom: "14px" }}>
          {task.obligation}
        </div>

        {/* Agency row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "7px",
              backgroundColor: "#16233F",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "10px", fontWeight: 700, color: "#E7E3D6" }}>{initials}</span>
          </div>
          <div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: actorDisplay.isPlaceholder ? "#86868B" : "#16233F",
                fontStyle: actorDisplay.isPlaceholder ? "italic" : undefined,
                ...(task.actorQuotedText && !actorDisplay.isPlaceholder ? { borderBottom: "1px dotted #86868B", cursor: "help" } : {}),
              }}
              title={task.actorQuotedText && !actorDisplay.isPlaceholder ? `Source: "${task.actorQuotedText}"` : undefined}
            >
              {actorDisplay.text}
            </div>
            {!actorDisplay.isPlaceholder && (
              <div style={{ fontSize: "13px", color: "#86868B" }}>Responsible agency</div>
            )}
          </div>
        </div>

        {/* Date + citation */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "12px",
            padding: "10px 12px",
            backgroundColor: "#FAFAFB",
            borderRadius: "8px",
            border: "1px solid #EDEDF0",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#86868B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "3px" }}>
              Due date
            </div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#1D1D1F" }}>
              {task.due ? formatDate(task.due) : "—"}
            </div>
          </div>
          {task.citation && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#86868B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "3px" }}>
                Source
              </div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "#1D1D1F" }}>
                {task.citation}
              </div>
            </div>
          )}
        </div>

        {/* Provenance chain */}
        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={() => setProvOpen(!provOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontSize: "13px",
              color: "#86868B",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transition: "transform 0.2s ease",
                transform: provOpen ? "rotate(90deg)" : "rotate(0deg)",
                fontSize: "13px",
              }}
            >
              &#x203A;
            </span>
            <span>{provSummaryText}</span>
          </button>
          {provOpen && (
            <div
              style={{
                marginTop: "8px",
                backgroundColor: "#FAFAFB",
                border: "1px solid #EDEDF0",
                borderRadius: "8px",
                padding: "10px 12px",
              }}
            >
              {provRows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginBottom: i < provRows.length - 1 ? "5px" : 0,
                    fontSize: "13px",
                  }}
                >
                  <span style={{ color: "#AEAEB2", fontWeight: 600, minWidth: "42px", flexShrink: 0 }}>
                    {row.actor}
                  </span>
                  <span>
                    <span style={{ color: "#6E6E73" }}>{row.label}</span>
                    <span style={{ color: "#6E6E73" }}> &mdash; </span>
                    <span style={{ color: "#1D1D1F" }}>{row.result}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Needs-input section */}
        {task.determination === "unresolved" && (
          <div
            style={{
              padding: "10px 12px",
              backgroundColor: STATUS_META.needs_input.bg,
              borderRadius: "8px",
              marginBottom: "12px",
            }}
          >
            {task.contingent ? (
              <>
                <div style={{ fontSize: "13px", color: STATUS_META.needs_input.color, fontWeight: 500, marginBottom: "4px" }}>
                  Contingent, no date available
                </div>
                <div style={{ fontSize: "13px", color: "#86868B", fontStyle: "italic" }}>
                  {task.referenceEventText
                    ? `Depends on: ${task.referenceEventText}`
                    : "This obligation depends on a future event whose date cannot be determined yet."}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "13px", color: STATUS_META.needs_input.color, fontWeight: 500, marginBottom: "6px" }}>
                  {task.inputAsk}
                </div>
                {!dateFormOpen ? (
                  <button
                    onClick={() => setDateFormOpen(true)}
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#5B5B8C",
                      background: "#FFFFFF",
                      border: "1px solid #D4D0E6",
                      borderRadius: "6px",
                      padding: "5px 14px",
                      cursor: "pointer",
                    }}
                  >
                    + Add date
                  </button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <input
                      type="date"
                      value={dateValue}
                      onChange={(e) => setDateValue(e.target.value)}
                      style={{
                        fontSize: "13px",
                        border: "1px solid #D4D0E6",
                        borderRadius: "6px",
                        padding: "5px 8px",
                      }}
                    />
                    <button
                      onClick={handleSaveDate}
                      disabled={saving || !dateValue}
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        backgroundColor: "#5B5B8C",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: "6px",
                        padding: "5px 14px",
                        cursor: saving || !dateValue ? "not-allowed" : "pointer",
                        opacity: saving || !dateValue ? 0.5 : 1,
                      }}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => { setDateFormOpen(false); setDateValue(""); }}
                      style={{ fontSize: "13px", color: "#86868B", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "10px 18px",
          borderTop: "1px solid #EDEDF0",
          backgroundColor: "#FAFAFB",
        }}
      >
        <button
          onClick={onViewInList}
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "#3C5A82",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          View in list &rarr;
        </button>
      </div>
      </div>
    </div>
  );
}

function TimelineMarker({
  task,
  pct,
  yOffset,
  labelYOffset,
  isSelected,
  onSelect,
  onAddDate,
  onViewInList,
}: {
  task: DocketTask;
  pct: number;
  yOffset: number;
  labelYOffset: number;
  isSelected: boolean;
  onSelect: (anchorId: string | null) => void;
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
  onViewInList: () => void;
}) {
  const meta = STATUS_META[task.status];
  const markerSize = 18;
  const markerRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    caretSide: "top" | "bottom";
    caretOffset: number;
  } | null>(null);

  useEffect(() => {
    if (!isSelected || !markerRef.current) {
      setPopoverPos(null);
      return;
    }

    function computePos() {
      if (!markerRef.current) return;
      const rect = markerRef.current.getBoundingClientRect();
      const popoverW = 370;
      const markerCX = rect.left + rect.width / 2;
      const viewW = window.innerWidth;

      let left = markerCX - popoverW / 2;
      if (left + popoverW > viewW - 12) left = viewW - 12 - popoverW;
      if (left < 12) left = 12;

      let top: number;
      let caretSide: "top" | "bottom";
      if (rect.top > 280) {
        top = rect.top - 8;
        caretSide = "bottom";
      } else {
        top = rect.bottom + 8;
        caretSide = "top";
      }

      const caretOffset = Math.max(18, Math.min(popoverW - 18, markerCX - left));
      setPopoverPos({ top, left, caretSide, caretOffset });
    }

    computePos();

    function handleScroll() {
      onSelect(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", computePos);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", computePos);
    };
  }, [isSelected, onSelect]);

  return (
    <div
      className="absolute"
      style={{
        left: `${pct}%`,
        top: `calc(50% + ${yOffset}px)`,
        transform: `translate(-${markerSize / 2}px, -${markerSize / 2}px)`,
        zIndex: isSelected ? 50 : 2,
      }}
    >
      <div
        ref={markerRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(isSelected ? null : task.anchorId);
        }}
        style={{
          cursor: "pointer",
          filter: isSelected ? `drop-shadow(0 0 6px ${meta.dot}88)` : "none",
          transition: "filter 0.15s ease",
        }}
      >
        <MarkerGlyph status={task.status} size={markerSize} />
      </div>
      <div
        style={{
          position: "absolute",
          top: `${markerSize + 1 + labelYOffset}px`,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: "10.5px",
          fontWeight: 600,
          color: meta.dot,
          whiteSpace: "nowrap",
          pointerEvents: "none",
          letterSpacing: "0.01em",
        }}
      >
        {shortDate(task.due!)}
      </div>
      {isSelected && popoverPos && createPortal(
        <div
          style={{
            position: "fixed",
            top: popoverPos.caretSide === "bottom" ? undefined : `${popoverPos.top}px`,
            bottom: popoverPos.caretSide === "bottom" ? `${window.innerHeight - popoverPos.top}px` : undefined,
            left: `${popoverPos.left}px`,
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskPopover
            task={task}
            onClose={() => onSelect(null)}
            onAddDate={onAddDate}
            onViewInList={onViewInList}
            caretSide={popoverPos.caretSide}
            caretOffset={popoverPos.caretOffset}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

interface MarkerLayout {
  markerY: number;
  labelY: number;
}

function computeMarkerLayout(
  tasks: DocketTask[],
  toPercent: (d: string) => number,
): Map<string, MarkerLayout> {
  const result = new Map<string, MarkerLayout>();
  const sorted = [...tasks].sort((a, b) => toPercent(a.due!) - toPercent(b.due!));
  const MARKER_STEP = 18;
  const LABEL_COLLISION_PCT = 5;
  const placed: { pct: number; markerY: number; labelBottom: number; id: string }[] = [];

  for (const t of sorted) {
    const pct = toPercent(t.due!);
    let markerY = 0;
    let labelExtraY = 0;
    let attempt = 0;
    const offsets = [0, -MARKER_STEP, MARKER_STEP, -MARKER_STEP * 2, MARKER_STEP * 2];

    while (attempt < offsets.length) {
      markerY = offsets[attempt];
      const labelBottom = markerY + 19 + labelExtraY;
      let collides = false;
      for (const p of placed) {
        if (Math.abs(pct - p.pct) < LABEL_COLLISION_PCT) {
          if (Math.abs(markerY - p.markerY) < MARKER_STEP) {
            collides = true;
            break;
          }
          if (Math.abs(labelBottom - p.labelBottom) < 13) {
            labelExtraY += 13;
          }
        }
      }
      if (!collides) break;
      attempt++;
    }

    const finalLabelBottom = markerY + 19 + labelExtraY;
    placed.push({ pct, markerY, labelBottom: finalLabelBottom, id: t.anchorId });
    result.set(t.anchorId, { markerY, labelY: labelExtraY });
  }
  return result;
}

function TimelineChart({
  tasks,
  onAddDate,
  onViewInList,
}: {
  tasks: DocketTask[];
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
  onViewInList: (anchorId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    function handleClickOutside(e: MouseEvent) {
      if (chartRef.current && !chartRef.current.contains(e.target as Node)) {
        setSelectedId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedId]);

  const datedTasks = tasks.filter((t) => t.due);
  if (datedTasks.length === 0) {
    return (
      <div className="py-12 text-center" style={{ color: "#AEAEB2" }}>
        <div style={{ fontSize: "15px", fontWeight: 500, marginBottom: "4px" }}>
          No dated tasks to display
        </div>
        <div style={{ fontSize: "13px" }}>
          Tasks will appear here once dates are computed or supplied.
        </div>
      </div>
    );
  }

  const dates = datedTasks.map((t) => new Date(t.due! + "T00:00:00").getTime());
  const minTs = Math.min(...dates);
  const maxTs = Math.max(...dates);
  const spreadMs = maxTs - minTs;
  const padMs = Math.max(spreadMs * 0.15, 15 * 86400000);
  const minDate = new Date(minTs - padMs);
  const maxDate = new Date(maxTs + padMs);

  const rangeMs = maxDate.getTime() - minDate.getTime();
  const toPercent = (d: string) => {
    const ms = new Date(d + "T00:00:00").getTime() - minDate.getTime();
    return Math.max(0.5, Math.min(99.5, (ms / rangeMs) * 100));
  };

  const months: { label: string; shortLabel: string; pct: number }[] = [];
  const cursor = new Date(minDate);
  cursor.setDate(1);
  if (cursor.getTime() < minDate.getTime()) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= maxDate.getTime()) {
    const pct = ((cursor.getTime() - minDate.getTime()) / rangeMs) * 100;
    months.push({
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      shortLabel: cursor.toLocaleDateString("en-US", { month: "short" }),
      pct,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPct = ((today.getTime() - minDate.getTime()) / rangeMs) * 100;
  const showToday = todayPct >= 0 && todayPct <= 100;

  const byAgency = new Map<string, DocketTask[]>();
  for (const t of datedTasks) {
    const label = formatActorDisplay(t.actor).text;
    const list = byAgency.get(label) ?? [];
    list.push(t);
    byAgency.set(label, list);
  }
  const agencies = Array.from(byAgency.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  const rowHeight = 72;
  const labelWidth = 190;
  const headerHeight = 40;
  const statusCounts = countStatuses(datedTasks);
  const activeStatuses = (
    ["overdue", "due_soon", "upcoming", "needs_input", "completed"] as TaskStatus[]
  ).filter((s) => statusCounts[s] > 0);

  return (
    <div>
      {/* Legend bar */}
      <div
        className="mb-5 flex flex-wrap items-center gap-5"
        style={{ padding: "0 2px" }}
      >
        {activeStatuses.map((s) => (
          <div key={s} className="flex items-center gap-2">
            <MarkerGlyph status={s} size={14} />
            <span style={{ fontSize: "13px", color: "#1D1D1F", fontWeight: 500 }}>
              {STATUS_META[s].label}
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: STATUS_META[s].color,
                backgroundColor: STATUS_META[s].bg,
                borderRadius: "9999px",
                padding: "1px 7px",
                minWidth: "20px",
                textAlign: "center",
              }}
            >
              {statusCounts[s]}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: "13px", color: "#86868B" }}>
          {datedTasks.length} task{datedTasks.length !== 1 ? "s" : ""} &middot;{" "}
          {agencies.length} agenc{agencies.length !== 1 ? "ies" : "y"}
        </div>
      </div>

      <div ref={chartRef} className="overflow-x-auto" style={{ borderRadius: "10px", border: "1px solid #E5E5EA" }} onClick={() => setSelectedId(null)}>
        <div style={{ minWidth: "780px" }}>
          {/* Month column headers */}
          <div
            className="relative flex"
            style={{
              height: `${headerHeight}px`,
              marginLeft: `${labelWidth}px`,
              background: "#F8F8FA",
              borderBottom: "1px solid #E5E5EA",
            }}
          >
            {months.map((m) => (
              <div
                key={m.label}
                className="absolute"
                style={{
                  left: `${m.pct}%`,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  transform: "translateX(-50%)",
                }}
              >
                <span
                  style={{
                    color: "#6E6E73",
                    whiteSpace: "nowrap",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}
                >
                  {m.label}
                </span>
              </div>
            ))}
            {showToday && (
              <div
                className="absolute"
                style={{
                  left: `${todayPct}%`,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  transform: "translateX(-50%)",
                  zIndex: 5,
                }}
              >
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    color: "#fff",
                    backgroundColor: "#C8983E",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    boxShadow: "0 1px 4px rgba(200,152,62,0.35)",
                  }}
                >
                  Today
                </span>
              </div>
            )}
          </div>

          {/* Agency rows */}
          {agencies.map(([name, agTasks], rowIdx) => {
            const isPlaceholderActor = agTasks[0] ? formatActorDisplay(agTasks[0].actor).isPlaceholder : false;
            const sortedTasks = [...agTasks].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
            const markerLayouts = computeMarkerLayout(agTasks, toPercent);
            const rowTint = ROW_TINTS[rowIdx % ROW_TINTS.length];
            const primaryStatus = agTasks.reduce((worst, t) => {
              const order: TaskStatus[] = ["overdue", "needs_input", "due_soon", "upcoming", "completed"];
              return order.indexOf(t.status) < order.indexOf(worst) ? t.status : worst;
            }, "completed" as TaskStatus);

            return (
              <div
                key={name}
                className="flex"
                style={{
                  height: `${rowHeight}px`,
                  borderBottom: rowIdx < agencies.length - 1 ? "1px solid #EDEDF0" : "none",
                }}
              >
                {/* Agency label column */}
                <div
                  className="flex shrink-0 items-center"
                  style={{
                    width: `${labelWidth}px`,
                    backgroundColor: rowTint,
                    borderRight: "1px solid #EDEDF0",
                    padding: "0 14px 0 0",
                  }}
                >
                  <div
                    style={{
                      width: "3px",
                      alignSelf: "stretch",
                      backgroundColor: STATUS_META[primaryStatus].dot,
                      borderRadius: "0 2px 2px 0",
                      opacity: 0.7,
                    }}
                  />
                  <div style={{ paddingLeft: "12px", minWidth: 0 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: isPlaceholderActor ? "#86868B" : "#16233F",
                        fontStyle: isPlaceholderActor ? "italic" : undefined,
                        lineHeight: "1.3",
                      }}
                    >
                      {name}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 400, color: "#86868B", marginTop: "2px" }}>
                      {agTasks.length} task{agTasks.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                {/* Chart area */}
                <div
                  className="relative flex-1"
                  style={{
                    height: `${rowHeight}px`,
                    backgroundColor: rowIdx % 2 === 0 ? "#FAFAFB" : "#FFFFFF",
                  }}
                >
                  {/* Vertical month gridlines */}
                  {months.map((m) => (
                    <div
                      key={m.label}
                      className="absolute top-0 bottom-0"
                      style={{ left: `${m.pct}%`, width: "1px", background: "#EDEDF0" }}
                    />
                  ))}

                  {/* Colored connector line between markers */}
                  {sortedTasks.length > 1 && (() => {
                    const first = toPercent(sortedTasks[0].due!);
                    const last = toPercent(sortedTasks[sortedTasks.length - 1].due!);
                    const firstColor = STATUS_META[sortedTasks[0].status].dot;
                    const lastColor = STATUS_META[sortedTasks[sortedTasks.length - 1].status].dot;
                    return (
                      <div
                        className="absolute"
                        style={{
                          left: `${first}%`,
                          width: `${last - first}%`,
                          top: "50%",
                          height: "3px",
                          transform: "translateY(-1.5px)",
                          background: `linear-gradient(90deg, ${firstColor}, ${lastColor})`,
                          borderRadius: "2px",
                          opacity: 0.35,
                          zIndex: 1,
                        }}
                      />
                    );
                  })()}

                  {/* Single-task baseline hint */}
                  {sortedTasks.length === 1 && (
                    <div
                      className="absolute"
                      style={{
                        left: `${Math.max(0, toPercent(sortedTasks[0].due!) - 3)}%`,
                        width: "6%",
                        top: "50%",
                        height: "3px",
                        transform: "translateY(-1.5px)",
                        background: `linear-gradient(90deg, transparent, ${STATUS_META[sortedTasks[0].status].dot}40, transparent)`,
                        borderRadius: "2px",
                        zIndex: 1,
                      }}
                    />
                  )}

                  {/* Today band */}
                  {showToday && (
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${todayPct}%`,
                        width: "3px",
                        transform: "translateX(-1.5px)",
                        background: "#C8983E",
                        opacity: 0.5,
                        zIndex: 3,
                        borderRadius: "1.5px",
                      }}
                    />
                  )}

                  {/* Task markers */}
                  {agTasks.map((t) => {
                    const layout = markerLayouts.get(t.anchorId);
                    return (
                      <TimelineMarker
                        key={t.anchorId}
                        task={t}
                        pct={toPercent(t.due!)}
                        yOffset={layout?.markerY ?? 0}
                        labelYOffset={layout?.labelY ?? 0}
                        isSelected={selectedId === t.anchorId}
                        onSelect={setSelectedId}
                        onAddDate={onAddDate}
                        onViewInList={() => onViewInList(t.anchorId)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UrgencyBanner({ tasks }: { tasks: DocketTask[] }) {
  const resolvedCount = tasks.filter((t) => t.due !== null && t.due !== undefined).length;
  const overdueCount = tasks.filter((t) => t.status === "overdue").length;
  if (overdueCount > 0) {
    return (
      <div
        style={{
          backgroundColor: "#A8442C",
          color: "#FFFFFF",
          padding: "10px 18px",
          borderRadius: "10px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "15px",
          fontWeight: 600,
          fontFamily: "var(--font-body)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20">
          <path d="M10 1.5L19 17.5H1L10 1.5Z" fill="#fff" strokeLinejoin="round" />
          <text x="10" y="14.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#A8442C">!</text>
        </svg>
        {overdueCount} deadline{overdueCount !== 1 ? "s" : ""} overdue &mdash; review immediately
      </div>
    );
  }
  if (resolvedCount === 0) {
    return (
      <div
        style={{
          backgroundColor: "#F5EFE0",
          color: "#8B7355",
          padding: "10px 18px",
          borderRadius: "10px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "15px",
          fontWeight: 600,
          fontFamily: "var(--font-body)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="9" fill="none" stroke="#8B7355" strokeWidth="2" />
          <text x="10" y="14" textAnchor="middle" fontSize="12" fontWeight="700" fill="#8B7355">?</text>
        </svg>
        No dates resolved &mdash; all obligations need trigger dates or additional context
      </div>
    );
  }
  return (
    <div
      style={{
        backgroundColor: "#E9F2EC",
        color: "#3F6B54",
        padding: "10px 18px",
        borderRadius: "10px",
        marginBottom: "16px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontSize: "15px",
        fontWeight: 600,
        fontFamily: "var(--font-body)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill="#3F6B54" />
        <path d="M6 10.5L9 13.5L14 7.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      All deadlines on track
    </div>
  );
}

function BriefingSummaryLine({ tasks }: { tasks: DocketTask[] }) {
  const total = tasks.length;
  const overdueCount = tasks.filter((t) => t.status === "overdue").length;
  const needsInputCount = tasks.filter((t) => t.status === "needs_input").length;
  const agencies = new Set(tasks.map((t) => formatActorDisplay(t.actor).text)).size;
  const datedTasks = tasks
    .filter((t) => t.due)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const today = new Date().toISOString().slice(0, 10);
  const nextDue = datedTasks.find((t) => t.due! >= today);

  const parts: string[] = [];
  parts.push(`${total} obligation${total !== 1 ? "s" : ""} tracked`);
  if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
  if (needsInputCount > 0) parts.push(`${needsInputCount} awaiting input`);
  parts.push(`${agencies} agenc${agencies !== 1 ? "ies" : "y"}`);
  if (nextDue) parts.push(`next deadline ${formatDate(nextDue.due!)}`);

  return (
    <div
      style={{
        fontSize: "14px",
        color: "#6E6E73",
        marginBottom: "16px",
        fontFamily: "var(--font-body)",
        lineHeight: 1.5,
      }}
    >
      {parts.join(" · ")}
    </div>
  );
}

function CalendarSyncBar({
  dvId,
  onOpenModal,
  syncStatus,
  onSync,
  syncing,
}: {
  dvId: string;
  onOpenModal: () => void;
  syncStatus: { connected: boolean; provider?: string; synced: boolean; eventCount: number } | null;
  onSync: () => void;
  syncing: boolean;
}) {
  const connected = syncStatus?.connected ?? false;
  const provider = syncStatus?.provider ?? null;
  const synced = syncStatus?.synced ?? false;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        backgroundColor: "#FAFAFB",
        borderRadius: "10px",
        border: "1px solid #EDEDF0",
        marginBottom: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="3" width="16" height="13" rx="2" stroke="#16233F" strokeWidth="1.5" />
          <line x1="1" y1="7.5" x2="17" y2="7.5" stroke="#16233F" strokeWidth="1.5" />
          <line x1="5.5" y1="1" x2="5.5" y2="4.5" stroke="#16233F" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12.5" y1="1" x2="12.5" y2="4.5" stroke="#16233F" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: "14px", color: "#1D1D1F", fontWeight: 500 }}>
          {connected
            ? (synced ? `Synced to ${provider ?? "calendar"}` : `Connected to ${provider ?? "calendar"}`)
            : "Calendar not connected"}
        </span>
        {connected && synced && (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#3F6B54",
              backgroundColor: "#E9F2EC",
              borderRadius: "4px",
              padding: "1px 6px",
            }}
          >
            Active
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        {connected && (
          <button
            onClick={onSync}
            disabled={syncing}
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#16233F",
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E5EA",
              borderRadius: "8px",
              padding: "5px 14px",
              cursor: syncing ? "not-allowed" : "pointer",
              opacity: syncing ? 0.5 : 1,
              fontFamily: "var(--font-body)",
            }}
          >
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        )}
        <button
          onClick={onOpenModal}
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: connected ? "#6E6E73" : "#16233F",
            backgroundColor: connected ? "transparent" : "#FFFFFF",
            border: connected ? "none" : "1px solid #E5E5EA",
            borderRadius: "8px",
            padding: "5px 14px",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          {connected ? "Change" : "Connect calendar"}
        </button>
      </div>
    </div>
  );
}

function ProviderButton({
  label,
  subtitle,
  initial,
  initialBg,
  initialColor,
  onClick,
}: {
  label: string;
  subtitle: string;
  initial: string;
  initialBg: string;
  initialColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        width: "100%",
        padding: "14px 16px",
        backgroundColor: "#FAFAFB",
        border: "1px solid #EDEDF0",
        borderRadius: "10px",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "8px",
          backgroundColor: initialBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "16px", fontWeight: 700, color: initialColor }}>
          {initial}
        </span>
      </div>
      <div>
        <div style={{ fontSize: "15px", fontWeight: 600, color: "#1D1D1F" }}>
          {label}
        </div>
        <div style={{ fontSize: "13px", color: "#86868B" }}>{subtitle}</div>
      </div>
    </button>
  );
}

function CalendarSyncModal({
  dvId,
  onClose,
  userPlan,
}: {
  dvId: string;
  onClose: () => void;
  userPlan: string;
}) {
  const [step, setStep] = useState<"select" | "confirm" | "waitlist">("select");
  const [provider, setProvider] = useState<string | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);

  function handleSelect(p: string) {
    if (p === "apple") {
      window.location.href = `/api/v1/documents/${dvId}/export/ics`;
      onClose();
      return;
    }
    if (userPlan === "free") {
      setProvider(p);
      setStep("waitlist");
      return;
    }
    setProvider(p);
    setStep("confirm");
  }

  function handleConnect() {
    if (provider === "google") {
      window.location.href = "/api/v1/calendar/google/auth";
    }
  }

  async function handleWaitlistSubmit() {
    if (!waitlistEmail) return;
    setWaitlistSubmitting(true);
    try {
      const { submitWaitlist: submit } = await import("@/lib/api");
      await submit(waitlistEmail, "calendar_sync");
      setWaitlistSubmitted(true);
    } catch { /* ignore */ }
    setWaitlistSubmitting(false);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          width: "420px",
          maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #EDEDF0",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: "#16233F",
                fontFamily: "var(--font-heading)",
              }}
            >
              {step === "select" && "Connect Calendar"}
              {step === "confirm" && `Connect ${provider === "google" ? "Google Calendar" : "Microsoft Outlook"}`}
              {step === "waitlist" && "Calendar sync is a paid feature"}
            </div>
            <div style={{ fontSize: "14px", color: "#6E6E73", marginTop: "4px" }}>
              {step === "select" && "Choose where to sync your deadlines"}
              {step === "confirm" && "Authorize access to add deadline events"}
              {step === "waitlist" && "We’re onboarding paid users individually right now"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#86868B",
              fontSize: "20px",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          {step === "select" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <ProviderButton
                label="Google Calendar"
                subtitle={userPlan === "free" ? "Paid feature" : "Sync via Google account"}
                initial="G"
                initialBg="#E8F0FE"
                initialColor="#4285F4"
                onClick={() => handleSelect("google")}
              />
              <ProviderButton
                label="Microsoft Outlook"
                subtitle="Coming soon"
                initial="O"
                initialBg="#E5F1FB"
                initialColor="#0078D4"
                onClick={() => {}}
              />
              <ProviderButton
                label="Apple Calendar"
                subtitle="Download .ics file (free)"
                initial="A"
                initialBg="#F0F0F2"
                initialColor="#1D1D1F"
                onClick={() => handleSelect("apple")}
              />
            </div>
          )}

          {step === "confirm" && (
            <div>
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#FAFAFB",
                  borderRadius: "10px",
                  border: "1px solid #EDEDF0",
                  fontSize: "15px",
                  color: "#1D1D1F",
                  lineHeight: 1.5,
                  marginBottom: "20px",
                }}
              >
                You&apos;ll be redirected to Google to authorize access.
                PolicyAction will create a dedicated calendar and push all
                dated deadlines as events, kept in sync on each re-analysis.
              </div>
              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setStep("select")}
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "1px solid #E5E5EA",
                    backgroundColor: "#FFFFFF",
                    color: "#1D1D1F",
                    cursor: "pointer",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#16233F",
                    color: "#F5F2E8",
                    cursor: "pointer",
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          {step === "waitlist" && (
            <div>
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#FBF8F0",
                  borderRadius: "10px",
                  border: "1px solid #E8DCC8",
                  fontSize: "15px",
                  color: "#1D1D1F",
                  lineHeight: 1.5,
                  marginBottom: "20px",
                }}
              >
                Real-time calendar sync keeps your Google Calendar up to date
                as deadlines are computed, edited, or re-analyzed. Leave your
                email and we&apos;ll reach out when we&apos;re ready for you.
              </div>
              {waitlistSubmitted ? (
                <div style={{ fontSize: "14px", color: "#3F6B54", fontWeight: 600 }}>
                  Thanks! We&apos;ll be in touch.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    className="flex-1 rounded-lg border px-3 py-2 text-[14px]"
                    style={{ borderColor: "#E8DCC8" }}
                  />
                  <button
                    onClick={handleWaitlistSubmit}
                    disabled={waitlistSubmitting || !waitlistEmail}
                    className="rounded-lg px-4 py-2 text-[14px] font-semibold"
                    style={{
                      background: "#16233F",
                      color: "#F5F2E8",
                      opacity: waitlistSubmitting || !waitlistEmail ? 0.5 : 1,
                      cursor: waitlistSubmitting || !waitlistEmail ? "not-allowed" : "pointer",
                    }}
                  >
                    {waitlistSubmitting ? "Submitting..." : "Join waitlist"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CitationSliver({ task }: { task: DocketTask }) {
  if (task.determination === "reviewer") {
    return (
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "#A67326",
          backgroundColor: "rgba(200,152,62,0.12)",
          borderRadius: "4px",
          padding: "2px 8px",
          display: "inline-block",
        }}
      >
        Reviewer-supplied date
      </span>
    );
  }
  if (task.determination === "unresolved") {
    return (
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "#5B5B8C",
          backgroundColor: "rgba(131,119,176,0.12)",
          borderRadius: "4px",
          padding: "2px 8px",
          display: "inline-block",
        }}
      >
        {task.unresolvedReason}
      </span>
    );
  }
  return (
    <span style={{ fontSize: "13px", color: "#86868B" }}>
      {task.computedNote}
    </span>
  );
}

function TimelineTaskRow({
  task,
  onAddDate,
  onEditDate,
}: {
  task: DocketTask;
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
  onEditDate?: (anchorId: string, date: string) => Promise<void>;
}) {
  const meta = STATUS_META[task.status];
  const isOverdue = task.status === "overdue";
  const relLabel = daysUntilLabel(task.due, task.status);
  const [dateFormOpen, setDateFormOpen] = useState(false);
  const [dateValue, setDateValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.due ?? "");
  const [editSaving, setEditSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSaveDate() {
    if (!dateValue || !onAddDate) return;
    setSaving(true);
    try {
      await onAddDate(task.anchorId, dateValue);
    } finally {
      setSaving(false);
      setDateFormOpen(false);
      setDateValue("");
    }
  }

  return (
    <div
      style={{
        padding: "16px 18px",
        borderBottom: "1px solid #EDEDF0",
        borderLeft: isOverdue ? "3px solid #A8442C" : "3px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: meta.dot,
            flexShrink: 0,
            marginTop: "5px",
            animation: isOverdue ? "pulseDot 1.8s infinite" : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "15px",
              color: "#1D1D1F",
              marginBottom: "3px",
              lineHeight: 1.4,
            }}
          >
            {task.obligation}
          </div>
          <div
            style={{ fontSize: "13px", color: "#86868B", marginBottom: "5px" }}
          >
            {task.citation}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CitationSliver task={task} />
            {task.determination === "reviewer" && onEditDate && !editing && (
              <button
                onClick={() => setEditing(true)}
                style={{
                  fontSize: "13px",
                  color: "#A67326",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontWeight: 600,
                }}
              >
                Edit
              </button>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {task.due && !editing ? (
            <>
              <div
                style={{ fontSize: "16px", fontWeight: 600, color: "#1D1D1F" }}
              >
                {formatDate(task.due)}
              </div>
              {relLabel && (
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: meta.color,
                  }}
                >
                  {relLabel}
                </div>
              )}
            </>
          ) : editing ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="date"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                style={{
                  fontSize: "13px",
                  border: "1px solid #E8DCC8",
                  borderRadius: "6px",
                  padding: "4px 8px",
                }}
              />
              <button
                onClick={async () => {
                  if (!editValue || !onEditDate) return;
                  setEditSaving(true);
                  try {
                    await onEditDate(task.anchorId, editValue);
                  } finally {
                    setEditSaving(false);
                    setEditing(false);
                  }
                }}
                disabled={editSaving || !editValue}
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  backgroundColor: "#A67326",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 12px",
                  cursor: editSaving || !editValue ? "not-allowed" : "pointer",
                  opacity: editSaving || !editValue ? 0.5 : 1,
                }}
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditValue(task.due ?? "");
                }}
                style={{
                  fontSize: "13px",
                  color: "#86868B",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: STATUS_META.needs_input.color,
                backgroundColor: STATUS_META.needs_input.bg,
                borderRadius: "9999px",
                padding: "2px 8px",
              }}
            >
              Needs input
            </span>
          )}
        </div>
      </div>
      {task.determination === "unresolved" && (
        <div style={{ marginTop: "8px", paddingLeft: "20px" }}>
          {task.contingent ? (
            <div style={{ fontSize: "13px", color: "#86868B", fontStyle: "italic" }}>
              {task.referenceEventText
                ? `Contingent on: ${task.referenceEventText}`
                : "Contingent, no date available"}
            </div>
          ) : !dateFormOpen ? (
            <button
              onClick={() => setDateFormOpen(true)}
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "#5B5B8C",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              + Add date
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "13px", color: "#5B5B8C" }}>
                {task.inputAsk}
              </span>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                style={{
                  fontSize: "13px",
                  border: "1px solid #D4D0E6",
                  borderRadius: "6px",
                  padding: "4px 8px",
                }}
              />
              <button
                onClick={handleSaveDate}
                disabled={saving || !dateValue}
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  backgroundColor: "#5B5B8C",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 12px",
                  cursor: saving || !dateValue ? "not-allowed" : "pointer",
                  opacity: saving || !dateValue ? 0.5 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setDateFormOpen(false);
                  setDateValue("");
                }}
                style={{
                  fontSize: "13px",
                  color: "#86868B",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BillDetailPage({
  params,
}: {
  params: Promise<{ dvId: string }>;
}) {
  const { dvId } = use(params);
  const [tasks, setTasks] = useState<DocketTask[]>([]);
  const [coverage, setCoverage] = useState<FindingsResponse["coverage"] | null>(null);
  const [billTitle, setBillTitle] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billSession, setBillSession] = useState("");
  const [billJurisdiction, setBillJurisdiction] = useState("");
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ connected: boolean; provider?: string; synced: boolean; eventCount: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [userPlan, setUserPlan] = useState("free");

  useEffect(() => {
    fetchCalendarSyncStatus(dvId).then(setSyncStatus).catch(() => {});
    fetchUserInfo().then((u) => setUserPlan(u.plan)).catch(() => {});
  }, [dvId]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncCalendar(dvId);
      const status = await fetchCalendarSyncStatus(dvId);
      setSyncStatus(status);
    } catch { /* ignore */ }
    setSyncing(false);
  }, [dvId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFindings(dvId);
      const identity = data.legalIdentity;
      setBillTitle(
        identity.shortTitle ??
          (identity.chapter
            ? `Chapter ${identity.chapter}`
            : `${identity.instrumentType} ${identity.number}`),
      );
      setBillNumber(
        identity.chapter
          ? `Chapter ${identity.chapter}`
          : `${identity.instrumentType} ${identity.number}`,
      );
      setBillSession(identity.session);
      setBillJurisdiction(identity.jurisdiction);
      setCoverage(data.coverage);
      const num = identity.chapter
          ? `Chapter ${identity.chapter}`
          : `${identity.instrumentType} ${identity.number}`;
      setTasks(
        data.findings
          .filter((f) => f.anchored)
          .map((f) => findingToDocketTask(f, dvId, num)),
      );
    } finally {
      setLoading(false);
    }
  }, [dvId]);

  useEffect(() => {
    loadData();
    addStoredBill(dvId);
  }, [loadData, dvId]);

  const handleReanalyze = useCallback(async () => {
    setReanalyzing(true);
    try {
      for await (const event of streamAnalysis(dvId)) {
        if (event.stage === "complete") break;
        if (event.status === "failed") break;
      }
      await loadData();
      // Re-sync calendar after re-analysis if connected
      if (syncStatus?.connected) {
        syncCalendar(dvId).then(() => fetchCalendarSyncStatus(dvId).then(setSyncStatus)).catch(() => {});
      }
    } finally {
      setReanalyzing(false);
    }
  }, [dvId, loadData, syncStatus]);

  const handleAddDate = useCallback(
    async (anchorId: string, date: string) => {
      await supplyInput(dvId, anchorId, "web-user", {
        deadlineDate: date,
      });
      const data = await fetchFindings(dvId);
      const identity = data.legalIdentity;
      const num = identity.chapter
        ? `Chapter ${identity.chapter}`
        : `${identity.instrumentType} ${identity.number}`;
      setTasks(
        data.findings
          .filter((f) => f.anchored)
          .map((f) => findingToDocketTask(f, dvId, num)),
      );
    },
    [dvId],
  );

  const handleEditDate = useCallback(
    async (anchorId: string, deadlineDate: string) => {
      await editRecordDate(dvId, anchorId, "web-user", deadlineDate);
      const data = await fetchFindings(dvId);
      const identity = data.legalIdentity;
      const num = identity.chapter
        ? `Chapter ${identity.chapter}`
        : `${identity.instrumentType} ${identity.number}`;
      setTasks(
        data.findings
          .filter((f) => f.anchored)
          .map((f) => findingToDocketTask(f, dvId, num)),
      );
      // Re-sync calendar after date edit if connected
      if (syncStatus?.connected) {
        syncCalendar(dvId).then(() => fetchCalendarSyncStatus(dvId).then(setSyncStatus)).catch(() => {});
      }
    },
    [dvId, syncStatus],
  );

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Filtering
  const filtered = tasks.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (agencyFilter !== "all" && formatActorDisplay(t.actor).text !== agencyFilter)
      return false;
    return true;
  });

  // Agency list for dropdown
  const uniqueAgencies = Array.from(
    new Set(tasks.map((t) => formatActorDisplay(t.actor).text)),
  ).sort();

  // Group by agency for list view
  const byAgency = new Map<string, DocketTask[]>();
  for (const t of filtered) {
    const label = formatActorDisplay(t.actor).text;
    const list = byAgency.get(label) ?? [];
    list.push(t);
    byAgency.set(label, list);
  }
  const agencyGroups = Array.from(byAgency.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

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
            fontSize: "30px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Bill detail
        </div>
        <div className="text-[14px]" style={{ color: "#6E6E73" }}>
          {today}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 md:p-8">
        {loading ? (
          <div className="py-16 text-center text-[15px]" style={{ color: "#AEAEB2" }}>
            Loading bill details...
          </div>
        ) : (
          <>
            {/* Back link */}
            <Link
              href="/docket"
              className="mb-4 inline-block text-[14px] no-underline"
              style={{ color: "#6E6E73" }}
            >
              &lt; All bills
            </Link>

            {/* Bill header */}
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div style={{ fontSize: "14px", letterSpacing: "0.03em", color: "#6E6E73", marginBottom: "6px", fontFamily: "var(--font-body)" }}>
                  {billNumber} &middot; {billSession} &middot; {billJurisdiction}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "28px",
                    fontWeight: 700,
                    letterSpacing: "-0.025em",
                    lineHeight: 1.15,
                    color: "#16233F",
                  }}
                >
                  {billTitle}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/api/v1/documents/${dvId}/source`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center no-underline transition-colors"
                  style={{
                    backgroundColor: "transparent",
                    color: "#16233F",
                    fontSize: "15px",
                    fontWeight: 600,
                    fontFamily: "var(--font-body)",
                    borderRadius: "10px",
                    padding: "8px 18px",
                    border: "1px solid #D1D1D6",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F0F0F2"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  View source
                </a>
                <a
                  href={`/api/v1/documents/${dvId}/export/ics`}
                  className="inline-flex items-center justify-center no-underline transition-colors"
                  style={{
                    backgroundColor: "#16233F",
                    color: "#F5F2E8",
                    fontSize: "15px",
                    fontWeight: 600,
                    fontFamily: "var(--font-body)",
                    borderRadius: "10px",
                    padding: "8px 18px",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#C8983E"; e.currentTarget.style.color = "#16233F"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#16233F"; e.currentTarget.style.color = "#F5F2E8"; }}
                >
                  Download .ics
                </a>
              </div>
            </div>

            {/* View toggle */}
            <div className="mb-4 flex items-center gap-3">
              <div
                className="inline-flex items-center"
                style={{
                  backgroundColor: "#F0F0F2",
                  borderRadius: "12px",
                  padding: "3px",
                }}
              >
                <button
                  onClick={() => setView("list")}
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "6px 16px",
                    borderRadius: "9px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: view === "list" ? "#FFFFFF" : "transparent",
                    boxShadow:
                      view === "list"
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                    color: "#1D1D1F",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  List
                </button>
                <button
                  onClick={() => setView("timeline")}
                  className="hidden md:inline-flex"
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "6px 16px",
                    borderRadius: "9px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: view === "timeline" ? "#FFFFFF" : "transparent",
                    boxShadow:
                      view === "timeline"
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                    color: "#1D1D1F",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  Timeline
                </button>
              </div>
              <span className="text-[13px] md:hidden" style={{ color: "#86868B" }}>
                Timeline view available on larger screens.
              </span>
            </div>

            {/* Status filters */}
            <div className="mb-3 flex flex-wrap gap-2">
              {STATUS_FILTERS.map((sf) => {
                const active = statusFilter === sf.key;
                return (
                  <button
                    key={sf.key}
                    onClick={() => setStatusFilter(sf.key)}
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      padding: "5px 14px",
                      borderRadius: "9999px",
                      border: active ? "none" : "1px solid #E5E5EA",
                      backgroundColor: active ? "#16233F" : "#FFFFFF",
                      color: active ? "#F5F2E8" : "#3A3A3C",
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    {sf.label}
                  </button>
                );
              })}
            </div>

            {/* Agency filter */}
            <div className="mb-3">
              <select
                value={agencyFilter}
                onChange={(e) => setAgencyFilter(e.target.value)}
                style={{
                  WebkitAppearance: "menulist",
                  appearance: "auto" as never,
                  fontSize: "14px",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: "1px solid #E5E5EA",
                  backgroundColor: "#FFFFFF",
                  color: "#1D1D1F",
                  cursor: "pointer",
                }}
              >
                <option value="all">All agencies</option>
                {uniqueAgencies.map((ag) => (
                  <option key={ag} value={ag}>
                    {ag}
                  </option>
                ))}
              </select>
            </div>

            {/* Coverage note */}
            {coverage && coverage.totalSegments > 0 && (
              <div className="mb-4 text-[13px]" style={{ color: "#86868B" }}>
                Coverage: {coverage.withCandidates} of {coverage.totalSegments} sections
                contained deadline language. This is processing coverage — not a claim
                about how many deadlines exist in this document.
              </div>
            )}

            {/* List view */}
            {view === "list" && (
              <div>
                {agencyGroups.length === 0 ? (
                  <div className="py-10 text-center" style={{ color: "#AEAEB2" }}>
                    {tasks.length === 0 ? (
                      <>
                        <div style={{ fontSize: "15px", marginBottom: "8px" }}>
                          No tracked tasks found for this document.
                        </div>
                        <div style={{ fontSize: "13px", marginBottom: "16px" }}>
                          Analysis may have been interrupted. You can re-analyze to try again.
                        </div>
                        <button
                          onClick={handleReanalyze}
                          disabled={reanalyzing}
                          style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            padding: "8px 20px",
                            borderRadius: "10px",
                            border: "none",
                            cursor: reanalyzing ? "default" : "pointer",
                            backgroundColor: "#16233F",
                            color: "#F5F2E8",
                            opacity: reanalyzing ? 0.6 : 1,
                          }}
                        >
                          {reanalyzing ? "Analyzing..." : "Re-analyze document"}
                        </button>
                      </>
                    ) : (
                      <div className="text-[15px]">No tasks match the current filters.</div>
                    )}
                  </div>
                ) : (
                  agencyGroups.map(([agency, agTasks]) => {
                    const isPlaceholder = agTasks[0] ? formatActorDisplay(agTasks[0].actor).isPlaceholder : false;
                    return (
                    <div key={agency} className="mb-6">
                      <div
                        className="mb-2.5 text-[14px] tracking-wide"
                        style={{
                          fontWeight: 600,
                          color: isPlaceholder ? "#86868B" : "#16233F",
                          fontStyle: isPlaceholder ? "italic" : undefined,
                          textTransform: isPlaceholder ? undefined : "uppercase",
                        }}
                      >
                        {agency}
                      </div>
                      <div
                        className="overflow-hidden rounded-[12px] border bg-white"
                        style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
                      >
                        {agTasks.map((t) => (
                          <TaskCard
                            key={t.anchorId}
                            id={`task-${t.anchorId}`}
                            task={t}
                            onAddDate={handleAddDate}
                            onEditDate={handleEditDate}
                          />
                        ))}
                      </div>
                    </div>
                  );
                  })
                )}
              </div>
            )}

            {/* Timeline view */}
            {view === "timeline" && (
              <div>
                <UrgencyBanner tasks={filtered} />
                <BriefingSummaryLine tasks={filtered} />
                <CalendarSyncBar dvId={dvId} onOpenModal={() => setSyncModalOpen(true)} syncStatus={syncStatus} onSync={handleSync} syncing={syncing} />

                <div
                  className="mb-6 overflow-hidden rounded-[12px] border bg-white"
                  style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
                >
                  <div
                    className="flex items-center gap-3"
                    style={{
                      padding: "16px 22px",
                      borderBottom: "1px solid #E5E5EA",
                      background: "#FAFAFB",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <rect x="1" y="3" width="16" height="13" rx="2" stroke="#16233F" strokeWidth="1.5" />
                      <line x1="1" y1="7.5" x2="17" y2="7.5" stroke="#16233F" strokeWidth="1.5" />
                      <line x1="5.5" y1="1" x2="5.5" y2="4.5" stroke="#16233F" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="12.5" y1="1" x2="12.5" y2="4.5" stroke="#16233F" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#16233F",
                        fontFamily: "var(--font-heading)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      Deadline timeline
                    </div>
                  </div>
                  <div style={{ padding: "20px 22px 28px" }}>
                    <TimelineChart
                      tasks={filtered}
                      onAddDate={handleAddDate}
                      onViewInList={(anchorId) => {
                        setView("list");
                        setStatusFilter("all");
                        setAgencyFilter("all");
                        setTimeout(() => {
                          const el = document.getElementById(`task-${anchorId}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 100);
                      }}
                    />
                  </div>
                </div>

                {agencyGroups.length > 0 && (
                  <div
                    className="overflow-hidden rounded-[12px] border"
                    style={{
                      borderColor: "#D8D8DC",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                    }}
                  >
                    {agencyGroups.map(([agency, agTasks]) => {
                      const isPlaceholder = agTasks[0] ? formatActorDisplay(agTasks[0].actor).isPlaceholder : false;
                      return (
                      <div key={agency}>
                        <div
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            backgroundColor: "#16233F",
                            color: "#E7E3D6",
                            padding: "10px 18px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div
                              style={{
                                width: "26px",
                                height: "26px",
                                borderRadius: "6px",
                                backgroundColor: "rgba(231,227,214,0.15)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <span style={{ fontSize: "10px", fontWeight: 700, color: "#E7E3D6" }}>
                                {isPlaceholder ? "?" : getAgencyInitials(agency)}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: "15px",
                                fontWeight: 700,
                                fontFamily: "var(--font-body)",
                                fontStyle: isPlaceholder ? "italic" : undefined,
                                opacity: isPlaceholder ? 0.7 : 1,
                              }}
                            >
                              {agency}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: "13px",
                              fontWeight: 500,
                              opacity: 0.6,
                            }}
                          >
                            {agTasks.length} task{agTasks.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div style={{ backgroundColor: "#FFFFFF" }}>
                          {agTasks.map((t) => (
                            <TimelineTaskRow
                              key={t.anchorId}
                              task={t}
                              onAddDate={handleAddDate}
                              onEditDate={handleEditDate}
                            />
                          ))}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}

                {syncModalOpen && (
                  <CalendarSyncModal dvId={dvId} onClose={() => { setSyncModalOpen(false); fetchCalendarSyncStatus(dvId).then(setSyncStatus).catch(() => {}); }} userPlan={userPlan} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
