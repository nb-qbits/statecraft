"use client";

import { useState } from "react";
import {
  STATUS_META,
  daysUntilLabel,
  provenanceFor,
  provenanceSummary,
} from "@/lib/docket-types";
import type { DocketTask } from "@/lib/docket-types";
import { StatusBadge } from "./status-badge";

export interface TaskCardProps {
  task: DocketTask;
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
  showBillContext?: boolean;
  id?: string;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PersonIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="5" cy="3" r="2" fill="#A67326" />
      <path
        d="M1 9.5C1 7.5 3 6 5 6C7 6 9 7.5 9 9.5"
        stroke="#A67326"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 1V9M1 5H9" stroke="#5B5B8C" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        transition: "transform 0.2s ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        fontSize: "11.5px",
        color: "#86868B",
      }}
    >
      &#x203A;
    </span>
  );
}

function ComputedRight({ task }: { task: DocketTask }) {
  const meta = STATUS_META[task.status];
  const daysLabel = daysUntilLabel(task.due, task.status);

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div className="text-right">
        {task.due && (
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#1D1D1F" }}>
            {formatDate(task.due)}
          </div>
        )}
        {daysLabel && (
          <div style={{ fontSize: "11.5px", fontWeight: 500, color: meta.color }}>
            {daysLabel}
          </div>
        )}
      </div>
      <StatusBadge status={task.status} />
    </div>
  );
}

function ReviewerRight({ task }: { task: DocketTask }) {
  const meta = STATUS_META[task.status];
  const daysLabel = daysUntilLabel(task.due, task.status);

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div className="text-right">
        <div
          className="flex items-center justify-end gap-1 mb-0.5"
          style={{ fontSize: "10.5px", color: "#A67326", fontWeight: 600 }}
        >
          <PersonIcon />
          <span>Entered by {task.reviewerName}</span>
        </div>
        {task.due && (
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#1D1D1F" }}>
            {formatDate(task.due)}
          </div>
        )}
        {daysLabel && (
          <div style={{ fontSize: "11.5px", fontWeight: 500, color: meta.color }}>
            {daysLabel}
          </div>
        )}
      </div>
      <StatusBadge status={task.status} />
    </div>
  );
}

function UnresolvedRight({
  task,
  onAddDate,
}: {
  task: DocketTask;
  onAddDate?: (anchorId: string, date: string) => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [dateValue, setDateValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!dateValue || !onAddDate) return;
    setSaving(true);
    try {
      await onAddDate(task.anchorId, dateValue);
    } finally {
      setSaving(false);
      setFormOpen(false);
      setDateValue("");
    }
  }

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-3">
        <div
          className="text-right"
          style={{
            fontSize: "12px",
            color: "#5B5B8C",
            fontWeight: 500,
            maxWidth: "230px",
          }}
        >
          {task.unresolvedReason}
        </div>
        <StatusBadge status="needs_input" />
      </div>
      <div style={{ paddingLeft: "24px", marginTop: "8px" }}>
        {!formOpen ? (
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1"
            style={{
              fontSize: "12px",
              color: "#5B5B8C",
              fontWeight: 600,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <PlusIcon />
            <span>Add date</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span style={{ fontSize: "12px", color: "#5B5B8C" }}>
              {task.inputAsk}
            </span>
            <input
              type="date"
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
              style={{
                fontSize: "12px",
                border: "1px solid #EFEFF1",
                borderRadius: "6px",
                padding: "4px 8px",
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !dateValue}
              style={{
                fontSize: "12px",
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
                setFormOpen(false);
                setDateValue("");
              }}
              style={{
                fontSize: "12px",
                color: "#5B5B8C",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProvenanceDrillDown({ task }: { task: DocketTask }) {
  const [open, setOpen] = useState(false);
  const rows = provenanceFor(task);
  const summary = provenanceSummary(task);

  return (
    <div style={{ paddingLeft: "24px", marginTop: "6px" }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5"
        style={{
          fontSize: "11.5px",
          color: "#86868B",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <ChevronIcon open={open} />
        <span>{summary}</span>
      </button>
      {open && (
        <div
          style={{
            marginTop: "6px",
            backgroundColor: "#FAFAFB",
            border: "1px solid #EFEFF1",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex gap-2.5"
              style={{ marginBottom: i < rows.length - 1 ? "4px" : 0 }}
            >
              <span
                style={{
                  color: "#AEAEB2",
                  fontWeight: 600,
                  minWidth: "44px",
                  fontSize: "12px",
                }}
              >
                {row.actor}
              </span>
              <span style={{ fontSize: "12px" }}>
                <span style={{ color: "#6E6E73" }}>{row.label}</span>
                <span style={{ color: "#6E6E73" }}> &mdash; </span>
                <span style={{ color: "#1D1D1F" }}>{row.result}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskCard({ task, onAddDate, showBillContext, id }: TaskCardProps) {
  const meta = STATUS_META[task.status];

  return (
    <div id={id} style={{ padding: "15px 20px", borderBottom: "1px solid #EFEFF1" }}>
      <div className="flex items-center gap-4">
        {/* Status dot */}
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: meta.dot,
            flexShrink: 0,
            animation:
              task.status === "overdue" ? "pulseDot 1.8s infinite" : undefined,
          }}
        />

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <div
            style={{ fontSize: "14px", color: "#1D1D1F", marginBottom: "2px" }}
            className="truncate"
          >
            {task.obligation}
          </div>
          <div style={{ fontSize: "11.5px", color: "#86868B" }}>
            {showBillContext && task.billNumber && (
              <span style={{ marginRight: "6px" }}>{task.billNumber} &middot;</span>
            )}
            {task.citation}
          </div>
        </div>

        {/* Right side */}
        {task.determination === "computed" && <ComputedRight task={task} />}
        {task.determination === "reviewer" && <ReviewerRight task={task} />}
        {task.determination === "unresolved" && (
          <UnresolvedRight task={task} onAddDate={onAddDate} />
        )}
      </div>

      {/* Provenance drill-down */}
      <ProvenanceDrillDown task={task} />
    </div>
  );
}
