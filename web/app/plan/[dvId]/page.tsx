"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { fetchFindings, supplyInput, streamAnalysis, editRecordDate } from "@/lib/api";
import type { Finding, FindingsResponse, LegalIdentity, EngineVersions } from "@/lib/api";
import {
  formatDate,
  formatKind,
  formatUnresolvedReason,
  formatRruleSchedule,
  formatActorDisplay,
} from "@/lib/format";

type Tab = "timeline" | "owner" | "calendar" | "summary";

type UnresolvedCategory =
  | "supply_year"
  | "supply_trigger"
  | "supply_anchor"
  | "contingent";

function classNames(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ─── Classification (Part 6) ───

function classifyUnresolved(f: Finding): UnresolvedCategory {
  if (f.missingInputs?.includes("year")) return "supply_year";
  if (f.missingInputs?.includes("triggerDate")) return "supply_trigger";
  if (
    f.missingInputs?.includes("anchorDate") ||
    f.missingInputs?.includes("sessionDate")
  )
    return "supply_anchor";
  return "contingent";
}

// ─── Provenance (Part 7) ───

interface ProvenanceStep {
  label: string;
  status: "succeeded" | "failed";
  detail: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatParsedDetail(
  expr: Record<string, unknown> | null,
): string {
  if (!expr) return "parsed expression";
  const kind = expr.kind as string;
  switch (kind) {
    case "fixed_date": {
      const month = expr.month as number;
      const day = expr.day as number;
      const year = expr.year as number | null;
      return year
        ? `fixed date: ${MONTHS[month - 1]} ${day}, ${year}`
        : `fixed date: ${MONTHS[month - 1]} ${day} (year not specified)`;
    }
    case "relative_duration": {
      const qty = expr.quantity as number;
      const unit = (expr.unit as string).replace(/_/g, " ");
      const event = expr.referenceEventText as string | undefined;
      return event
        ? `${qty} ${unit} from "${event}"`
        : `${qty} ${unit} from trigger event`;
    }
    case "recurrence":
      return "recurring schedule";
    default:
      return kind.replace(/_/g, " ");
  }
}

function buildProvenance(f: Finding): ProvenanceStep[] {
  const steps: ProvenanceStep[] = [];

  steps.push({
    label: "AI identified",
    status: "succeeded",
    detail: `Extracted as ${formatKind(f.kind)}`,
  });

  steps.push({
    label: "Code verified",
    status: f.anchored ? "succeeded" : "failed",
    detail: f.anchored
      ? `Quote located in source via ${f.anchorMethod ?? "match"}`
      : (f.anchorFailureReason ?? "Verification failed"),
  });

  if (f.anchored) {
    steps.push({
      label: "Code parsed",
      status: f.grammarParsed ? "succeeded" : "failed",
      detail: f.grammarParsed
        ? formatParsedDetail(f.parsedExpression)
        : (f.grammarFailureReason ?? "Expression not recognized"),
    });
  }

  if (f.grammarParsed) {
    if (f.resolved) {
      const isEst = f.dateProvenance === "generic_default";
      const dateStr = f.rrule
        ? `Recurring: ${formatRruleSchedule(f.rrule)}`
        : f.statutoryDate
          ? formatDate(f.statutoryDate)
          : "computed";
      const adj =
        f.adjustedDate &&
        f.statutoryDate &&
        f.adjustedDate !== f.statutoryDate
          ? ` → adjusted to ${formatDate(f.adjustedDate)}`
          : "";
      const suffix = isEst ? " (estimated — not verified for this jurisdiction)" : "";
      steps.push({
        label: isEst ? "Estimated" : "Code computed",
        status: "succeeded",
        detail: `${dateStr}${adj}${suffix}`,
      });
    } else {
      steps.push({
        label: "Code computed",
        status: "failed",
        detail: f.unresolvedReason ?? "Could not compute date",
      });
    }
  }

  const isReviewerAsserted = f.citations.some((c) =>
    c.startsWith("reviewer_asserted:"),
  );
  if (f.status === "accepted" || f.status === "rejected") {
    steps.push({
      label: "Human decided",
      status: f.status === "accepted" ? "succeeded" : "failed",
      detail:
        f.status === "accepted"
          ? isReviewerAsserted
            ? "Date supplied by reviewer"
            : "Accepted by reviewer"
          : "Rejected by reviewer",
    });
  }

  return steps;
}

function provenanceSummary(steps: ProvenanceStep[]): string {
  return steps
    .map((s) => {
      switch (s.label) {
        case "AI identified":
          return "AI found";
        case "Code verified":
          return s.status === "succeeded"
            ? "code verified"
            : "verification failed";
        case "Code parsed":
          return s.status === "succeeded" ? "code parsed" : "parse failed";
        case "Code computed":
          return s.status === "succeeded" ? "code computed" : "unresolved";
        case "Estimated":
          return "estimated (generic)";
        case "Human decided":
          return s.status === "succeeded"
            ? "human accepted"
            : "human rejected";
        default:
          return s.label;
      }
    })
    .join(" · ");
}

// ─── Utility ───

function planCitations(f: Finding): string[] {
  return f.citations.filter(
    (c) =>
      !c.startsWith("recurrence rule:") &&
      !c.startsWith("year parity:") &&
      !c.startsWith("reviewer_asserted:"),
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const JURISDICTION_NAMES: Record<string, string> = {
  "us-fed": "Federal",
  "us-va": "Virginia",
  "us-ca": "California",
  "us-ny": "New York",
  "us-tx": "Texas",
  "us-fl": "Florida",
  "us-il": "Illinois",
  "us-pa": "Pennsylvania",
  "us-oh": "Ohio",
  "us-ga": "Georgia",
  "us-nc": "North Carolina",
  "us-md": "Maryland",
  "us-co": "Colorado",
  "us-mn": "Minnesota",
  "us-wa": "Washington",
  "us-or": "Oregon",
  "us-ma": "Massachusetts",
  "us-ct": "Connecticut",
  "us-nj": "New Jersey",
};

const SUPPORTED_PACKS = new Set(["us-va"]);

function JurisdictionLimitationNotice({ jurisdiction }: { jurisdiction: string }) {
  if (SUPPORTED_PACKS.has(jurisdiction)) return null;
  const isFederal = jurisdiction === "us-fed";
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
      <p className="text-sm font-medium text-blue-900">
        {isFederal
          ? "Federal legislation: limited support"
          : `Jurisdiction ${JURISDICTION_NAMES[jurisdiction] ?? jurisdiction}: limited support`}
      </p>
      <p className="mt-1 text-xs text-blue-800">
        {isFederal
          ? "Federal bills are parsed and spans are extracted, but statutory date computation requires a jurisdiction pack that does not yet exist for federal legislation. Dates that depend on session calendars, holiday schedules, or enactment-date rules cannot be resolved."
          : `This jurisdiction does not yet have a jurisdiction pack. Spans are extracted and parsed, but statutory date computation is not available.`}{" "}
        All findings below reflect what the engine could determine without jurisdiction-specific rules.
      </p>
    </div>
  );
}

function formatDocumentTitle(identity: LegalIdentity): string {
  const name = identity.chapter
    ? `Chapter ${identity.chapter}`
    : `${identity.instrumentType} ${identity.number}`;
  const jurisdiction = JURISDICTION_NAMES[identity.jurisdiction] ?? identity.jurisdiction;
  const subtitle = identity.shortTitle ?? jurisdiction;
  return `${name} (${identity.session}) — ${subtitle}`;
}

function computeDeadlineFromTrigger(
  triggerDate: string,
  expr: Record<string, unknown>,
): string {
  const qty = (expr.quantity as number) ?? 0;
  const unit = expr.unit as string;
  const preposition = expr.preposition as string | null;
  const multiplier = preposition === "before" ? -1 : 1;
  const d = new Date(triggerDate + "T00:00:00");

  if (unit === "months") {
    d.setMonth(d.getMonth() + qty * multiplier);
  } else if (unit === "years") {
    d.setFullYear(d.getFullYear() + qty * multiplier);
  } else {
    d.setDate(d.getDate() + qty * multiplier);
  }

  return d.toISOString().slice(0, 10);
}

// ─── Provenance Panel ───

function ProvenancePanel({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const steps = buildProvenance(finding);
  const summary = provenanceSummary(steps);

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-xs text-gray-500 hover:text-gray-700"
      >
        <span className="font-medium text-gray-600">
          How was this determined?
        </span>
        <span className="flex-1 truncate text-gray-400">{summary}</span>
        <span className="flex-shrink-0 text-[10px]">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
          {steps.map((step) => (
            <div key={step.label} className="flex items-start gap-2 text-xs">
              <span
                className={classNames(
                  "mt-0.5 flex-shrink-0 font-mono",
                  step.status === "succeeded"
                    ? "text-emerald-500"
                    : "text-red-400",
                )}
              >
                {step.status === "succeeded" ? "✓" : "✗"}
              </span>
              <div className="min-w-0">
                <span className="font-medium text-gray-700">
                  {step.label}
                </span>
                <span className="ml-1.5 text-gray-500">
                  — {step.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Supply Form (Part 6) ───

function SupplyForm({
  finding,
  category,
  onSupply,
}: {
  finding: Finding;
  category: "supply_year" | "supply_trigger";
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);

  const submitDate = async (deadlineDate: string) => {
    setSubmitting(true);
    setPendingDate(null);
    try {
      await onSupply(finding.anchorId, deadlineDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Supply failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    let deadlineDate: string;

    if (category === "supply_year") {
      const year = parseInt(value, 10);
      if (!year || year < 2000 || year > 2100) {
        setError("Enter a valid year");
        return;
      }
      const expr = finding.parsedExpression;
      if (
        !expr ||
        typeof expr.month !== "number" ||
        typeof expr.day !== "number"
      ) {
        setError("Cannot construct date — parsed expression missing");
        return;
      }
      deadlineDate = `${year}-${String(expr.month).padStart(2, "0")}-${String(expr.day).padStart(2, "0")}`;
    } else {
      if (!value) {
        setError("Enter a date");
        return;
      }
      const expr = finding.parsedExpression;
      if (expr && typeof expr.quantity === "number") {
        deadlineDate = computeDeadlineFromTrigger(value, expr);
      } else {
        deadlineDate = value;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    if (deadlineDate < today) {
      setPendingDate(deadlineDate);
      return;
    }

    await submitDate(deadlineDate);
  };

  if (category === "supply_year") {
    const expr = finding.parsedExpression;
    const monthDay =
      expr && typeof expr.month === "number" && typeof expr.day === "number"
        ? `${MONTHS[expr.month - 1]} ${expr.day}`
        : "this date";

    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
        <span className="text-sm text-amber-900">
          What year for &ldquo;{monthDay}&rdquo;?
        </span>
        <input
          type="number"
          min={2000}
          max={2100}
          placeholder="e.g. 2025"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {submitting ? "Resolving…" : "Resolve"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
        {pendingDate && (
          <div className="flex w-full items-center gap-2 rounded border border-amber-400 bg-amber-100 px-3 py-1.5">
            <span className="text-xs text-amber-900">
              {formatDate(pendingDate)} is in the past. Confirm?
            </span>
            <button
              type="button"
              onClick={() => submitDate(pendingDate)}
              disabled={submitting}
              className="rounded bg-amber-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setPendingDate(null)}
              className="text-xs text-amber-700 underline hover:text-amber-900"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  const eventLabel = finding.referenceEventText;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
      <span className="text-sm text-amber-900">
        {eventLabel
          ? <>When did &ldquo;{eventLabel}&rdquo; occur?</>
          : "This document does not name what starts this clock. Supply the start date if you know it."}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-amber-300 bg-white px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {submitting ? "Resolving…" : "Resolve"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {pendingDate && (
        <div className="flex w-full items-center gap-2 rounded border border-amber-400 bg-amber-100 px-3 py-1.5">
          <span className="text-xs text-amber-900">
            {formatDate(pendingDate)} is in the past. Confirm?
          </span>
          <button
            type="button"
            onClick={() => submitDate(pendingDate)}
            disabled={submitting}
            className="rounded bg-amber-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPendingDate(null)}
            className="text-xs text-amber-700 underline hover:text-amber-900"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Finding Card ───

function FindingCard({
  finding,
  onSupply,
  onEditDate,
}: {
  finding: Finding;
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
  onEditDate: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const isRecurring = !!finding.rrule;
  const schedule = finding.rrule ? formatRruleSchedule(finding.rrule) : null;

  const now = new Date().toISOString().slice(0, 10);
  const nextOcc =
    finding.occurrences.find((o) => o.adjustedDate >= now) ??
    finding.occurrences[0];

  const displayDate =
    isRecurring && nextOcc
      ? nextOcc.adjustedDate
      : (finding.adjustedDate ?? finding.statutoryDate);

  const adjusted =
    finding.adjustedDate &&
    finding.statutoryDate &&
    finding.adjustedDate !== finding.statutoryDate;

  const category = !finding.resolved ? classifyUnresolved(finding) : null;
  const showSupplyForm =
    category === "supply_year" || category === "supply_trigger";

  const isReviewerAsserted = finding.citations.some((c) =>
    c.startsWith("reviewer_asserted:"),
  );
  const isEstimated = finding.dateProvenance === "generic_default";

  return (
    <div className={`rounded-lg border px-5 py-4 ${
      isEstimated
        ? "border-amber-200 bg-amber-50/30"
        : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline gap-3">
            {displayDate ? (
              <span className="text-base font-semibold text-gray-900">
                {formatDate(displayDate)}
              </span>
            ) : (
              <span className="text-base font-medium text-gray-700">
                {finding.provisionLabel || finding.structuralPath || "Obligation"}
              </span>
            )}
            {isEstimated && displayDate && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                estimated
              </span>
            )}
            {adjusted && (
              <span className="text-xs text-amber-700">
                statutory {formatDate(finding.statutoryDate!)} adjusted
              </span>
            )}
            {isRecurring && schedule && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isEstimated
                  ? "bg-amber-100 text-amber-800"
                  : "bg-indigo-100 text-indigo-700"
              }`}>
                {schedule}
              </span>
            )}
            {isReviewerAsserted && (
              <>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                  reviewer supplied
                </span>
                <button
                  type="button"
                  onClick={() => { setEditing(true); setEditDate(finding.adjustedDate ?? finding.statutoryDate ?? ""); }}
                  className="text-xs font-medium text-violet-600 hover:text-violet-800"
                >
                  Edit date
                </button>
              </>
            )}
          </div>

          <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-800">
            &ldquo;{finding.quotedText}&rdquo;
          </blockquote>

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            {(() => {
              const actorDisplay = formatActorDisplay(finding.actor);
              if (actorDisplay.isPlaceholder) {
                return (
                  <span className="italic text-gray-400">
                    {actorDisplay.text}
                  </span>
                );
              }
              return (
                <span
                  className="font-medium text-gray-700 border-b border-dotted border-gray-400 cursor-help"
                  title={finding.actorQuotedText ? `Source: "${finding.actorQuotedText}"` : undefined}
                >
                  {actorDisplay.text}
                </span>
              );
            })()}
            <span>
              {finding.provisionLabel || finding.structuralPath}
            </span>
            {planCitations(finding).length > 0 && (
              <span>{planCitations(finding).join(" · ")}</span>
            )}
          </div>

          {finding.dependsOnDescription && (
            <p className="text-sm text-amber-800">
              Depends on: {finding.dependsOnDescription}
            </p>
          )}

          {!finding.resolved && !showSupplyForm && finding.grammarParsed && (
            <p className="text-sm text-gray-600">
              {formatUnresolvedReason(finding)}
            </p>
          )}
        </div>

        <span
          className={classNames(
            "mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            isEstimated
              ? "bg-amber-100 text-amber-800"
              : finding.resolved
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600",
          )}
        >
          {isEstimated ? "estimated" : finding.resolved ? "resolved" : "unresolved"}
        </span>
      </div>

      {showSupplyForm && (
        <SupplyForm
          finding={finding}
          category={category as "supply_year" | "supply_trigger"}
          onSupply={onSupply}
        />
      )}

      {editing && (
        <div className="mt-3 flex items-center gap-2 rounded border border-violet-200 bg-violet-50 p-3">
          <label className="text-xs font-medium text-gray-700">Corrected date:</label>
          <input
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={editSaving || !editDate}
            onClick={async () => {
              setEditSaving(true);
              try {
                await onEditDate(finding.anchorId, editDate);
                setEditing(false);
              } finally {
                setEditSaving(false);
              }
            }}
            className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {editSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      <ProvenancePanel finding={finding} />
    </div>
  );
}

// ─── Timeline View ───

function TimelineBucket({
  label,
  findings,
  onSupply,
  onEditDate,
}: {
  label: string;
  findings: Finding[];
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
  onEditDate: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  if (findings.length === 0) {
    return (
      <div className="flex items-baseline justify-between border-b border-gray-100 py-3">
        <span className="text-sm font-medium uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <span className="text-sm text-gray-400">none</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between border-b border-gray-100 py-3">
        <span className="text-sm font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <span className="text-sm text-gray-500">
          {findings.length}{" "}
          {findings.length === 1 ? "obligation" : "obligations"}
        </span>
      </div>
      <div className="space-y-2 py-2">
        {findings.map((f) => (
          <FindingCard key={f.anchorId} finding={f} onSupply={onSupply} onEditDate={onEditDate} />
        ))}
      </div>
    </div>
  );
}

function UnresolvedSection({
  label,
  description,
  findings,
  onSupply,
  onEditDate,
}: {
  label: string;
  description: string;
  findings: Finding[];
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
  onEditDate: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  if (findings.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          {label}
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
      <div className="space-y-2">
        {findings.map((f) => (
          <FindingCard key={f.anchorId} finding={f} onSupply={onSupply} onEditDate={onEditDate} />
        ))}
      </div>
    </div>
  );
}

function TimelineView({
  findings,
  onSupply,
  onEditDate,
}: {
  findings: Finding[];
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
  onEditDate: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  const now = new Date().toISOString().slice(0, 10);
  const in30 = addDays(now, 30);
  const in90 = addDays(now, 90);
  const yearEnd = `${now.slice(0, 4)}-12-31`;

  function effectiveDate(f: Finding): string | null {
    if (f.rrule && f.occurrences.length > 0) {
      const next = f.occurrences.find((o) => o.adjustedDate >= now);
      return next?.adjustedDate ?? f.occurrences[0]?.adjustedDate ?? null;
    }
    return f.adjustedDate ?? f.statutoryDate;
  }

  const overdue: Finding[] = [];
  const next30: Finding[] = [];
  const next90: Finding[] = [];
  const thisYear: Finding[] = [];
  const later: Finding[] = [];
  const supplyable: Finding[] = [];
  const needsAnchor: Finding[] = [];
  const contingent: Finding[] = [];

  for (const f of findings) {
    const d = effectiveDate(f);
    if (d) {
      if (d < now) overdue.push(f);
      else if (d <= in30) next30.push(f);
      else if (d <= in90) next90.push(f);
      else if (d <= yearEnd) thisYear.push(f);
      else later.push(f);
    } else {
      const cat = classifyUnresolved(f);
      if (cat === "supply_year" || cat === "supply_trigger")
        supplyable.push(f);
      else if (cat === "supply_anchor") needsAnchor.push(f);
      else contingent.push(f);
    }
  }

  return (
    <div className="space-y-6">
      <TimelineBucket
        label="Overdue"
        findings={overdue}
        onSupply={onSupply}
        onEditDate={onEditDate}
      />
      <TimelineBucket
        label="Next 30 days"
        findings={next30}
        onSupply={onSupply}
        onEditDate={onEditDate}
      />
      <TimelineBucket
        label="Next 90 days"
        findings={next90}
        onSupply={onSupply}
        onEditDate={onEditDate}
      />
      <TimelineBucket
        label="This year"
        findings={thisYear}
        onSupply={onSupply}
        onEditDate={onEditDate}
      />
      <TimelineBucket
        label="Later"
        findings={later}
        onSupply={onSupply}
        onEditDate={onEditDate}
      />

      {(supplyable.length > 0 ||
        needsAnchor.length > 0 ||
        contingent.length > 0) && (
        <div className="mt-8 space-y-6">
          <UnresolvedSection
            label="Supply information to resolve"
            description="These obligations have a recognized date pattern but need one input to compute a deadline."
            findings={supplyable}
            onSupply={onSupply}
            onEditDate={onEditDate}
          />
          <UnresolvedSection
            label="Recurring — needs anchor date"
            description="These recurring obligations cannot generate occurrences without a fixed anchor date."
            findings={needsAnchor}
            onSupply={onSupply}
            onEditDate={onEditDate}
          />
          <UnresolvedSection
            label="Timing contingent"
            description="These obligations exist and are cited, but their timing depends on information this document does not contain."
            findings={contingent}
            onSupply={onSupply}
            onEditDate={onEditDate}
          />
        </div>
      )}
    </div>
  );
}

// ─── Owner View ───

function OwnerView({
  findings,
  onSupply,
  onEditDate,
}: {
  findings: Finding[];
  onSupply: (anchorId: string, deadlineDate: string) => Promise<void>;
  onEditDate: (anchorId: string, deadlineDate: string) => Promise<void>;
}) {
  const byActor = new Map<string, Finding[]>();
  for (const f of findings) {
    const display = formatActorDisplay(f.actor);
    const key = display.isPlaceholder
      ? "Accountable party not identified in this provision"
      : display.text;
    const list = byActor.get(key) ?? [];
    list.push(f);
    byActor.set(key, list);
  }

  const actors = [...byActor.keys()].sort((a, b) => {
    if (a === "Accountable party not identified in this provision") return 1;
    if (b === "Accountable party not identified in this provision") return -1;
    return (byActor.get(b)?.length ?? 0) - (byActor.get(a)?.length ?? 0);
  });

  return (
    <div className="space-y-8">
      {actors.map((actor) => (
        <div key={actor} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{actor}</h3>
            <span className="text-sm text-gray-500">
              {byActor.get(actor)!.length}{" "}
              {byActor.get(actor)!.length === 1
                ? "obligation"
                : "obligations"}
            </span>
          </div>
          <div className="space-y-2">
            {byActor.get(actor)!.map((f) => (
              <FindingCard
                key={f.anchorId}
                finding={f}
                onSupply={onSupply}
                onEditDate={onEditDate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar View ───

function CalendarView({ findings }: { findings: Finding[] }) {
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  const allDates = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.rrule && f.occurrences.length > 0) {
      for (const occ of f.occurrences) {
        const d = occ.adjustedDate;
        const list = allDates.get(d) ?? [];
        list.push(f);
        allDates.set(d, list);
      }
    } else if (f.adjustedDate) {
      const list = allDates.get(f.adjustedDate) ?? [];
      list.push(f);
      allDates.set(f.adjustedDate, list);
    } else if (f.statutoryDate) {
      const list = allDates.get(f.statutoryDate) ?? [];
      list.push(f);
      allDates.set(f.statutoryDate, list);
    }
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  const cells: Array<{ day: number | null; findings: Finding[] }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ day: null, findings: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, findings: allDates.get(iso) ?? [] });
  }

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const todayIso = now.toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          &larr;
        </button>
        <h3 className="text-lg font-semibold text-gray-900">{monthName}</h3>
        <button
          onClick={nextMonth}
          className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          &rarr;
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-gray-200">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-gray-50 py-2 text-center text-xs font-medium text-gray-500"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          const iso = cell.day
            ? `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`
            : "";
          const isToday = iso === todayIso;

          return (
            <div
              key={i}
              className={classNames(
                "min-h-[80px] bg-white px-2 py-1",
                !cell.day && "bg-gray-50",
              )}
            >
              {cell.day && (
                <>
                  <span
                    className={classNames(
                      "inline-block text-sm",
                      isToday
                        ? "rounded-full bg-indigo-600 px-1.5 py-0.5 font-semibold text-white"
                        : "text-gray-700",
                    )}
                  >
                    {cell.day}
                  </span>
                  {cell.findings.map((f, fi) => (
                    <div
                      key={`${f.anchorId}-${fi}`}
                      className="mt-0.5 truncate rounded bg-indigo-50 px-1 py-0.5 text-xs text-indigo-800"
                      title={f.quotedText}
                    >
                      {(() => { const d = formatActorDisplay(f.actor); return d.isPlaceholder ? formatKind(f.kind) : d.text; })()}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Summary View ───

function SummaryView({
  findings,
  legalIdentity,
}: {
  findings: Finding[];
  legalIdentity: LegalIdentity;
}) {
  const resolved = findings.filter((f) => f.resolved);
  const recurring = findings.filter((f) => !!f.rrule);

  const unresolvedFindings = findings.filter((f) => !f.resolved);
  const supplyable = unresolvedFindings.filter((f) => {
    const cat = classifyUnresolved(f);
    return cat === "supply_year" || cat === "supply_trigger";
  });
  const needsAnchor = unresolvedFindings.filter(
    (f) => classifyUnresolved(f) === "supply_anchor",
  );
  const contingentList = unresolvedFindings.filter(
    (f) => classifyUnresolved(f) === "contingent",
  );

  const now = new Date().toISOString().slice(0, 10);
  let nextAction: {
    date: string;
    text: string;
    citation: string;
  } | null = null;

  for (const f of findings) {
    let d: string | null = null;
    if (f.rrule && f.occurrences.length > 0) {
      const next = f.occurrences.find((o) => o.adjustedDate >= now);
      d = next?.adjustedDate ?? null;
    } else {
      d = f.adjustedDate ?? f.statutoryDate;
    }
    if (d && d >= now && (!nextAction || d < nextAction.date)) {
      nextAction = {
        date: d,
        text:
          f.quotedText.length > 80
            ? f.quotedText.slice(0, 80) + "…"
            : f.quotedText,
        citation: planCitations(f)[0] ?? "",
      };
    }
  }

  const allCitations = new Set<string>();
  for (const f of findings) {
    for (const c of planCitations(f)) allCitations.add(c);
  }

  const actors = new Set(
    findings
      .map((f) => {
        const d = formatActorDisplay(f.actor);
        return d.isPlaceholder ? null : d.text;
      })
      .filter(Boolean),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-lg border border-gray-200 bg-white px-8 py-6 print:border-0 print:shadow-none">
      <div>
        <p className="text-lg font-semibold text-gray-900">
          {formatDocumentTitle(legalIdentity)}
        </p>
      </div>

      <div className="space-y-1 text-gray-900">
        <p className="text-lg font-semibold">
          {findings.length} obligations identified
        </p>
        <p className="text-sm text-gray-600">
          {resolved.length} with computed dates
          {recurring.length > 0 && ` · ${recurring.length} recurring`}
          {supplyable.length > 0 &&
            ` · ${supplyable.length} resolvable with input`}
          {needsAnchor.length > 0 &&
            ` · ${needsAnchor.length} need anchor date`}
          {contingentList.length > 0 &&
            ` · ${contingentList.length} timing contingent`}
        </p>
      </div>

      {actors.size > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            Accountable parties
          </p>
          <p className="text-sm text-gray-600">{[...actors].join(", ")}</p>
        </div>
      )}

      {nextAction && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Next action
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatDate(nextAction.date)}
          </p>
          <p className="mt-0.5 text-sm text-gray-700">{nextAction.text}</p>
          {nextAction.citation && (
            <p className="mt-0.5 text-xs text-gray-500">
              {nextAction.citation}
            </p>
          )}
        </div>
      )}

      {allCitations.size > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Rules applied</p>
          <p className="text-sm text-gray-600">
            {[...allCitations].join(", ")}
          </p>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Every date traceable to quoted source text.
      </p>
    </div>
  );
}

// ─── Stale Analysis Banner ───

const STAGE_DISPLAY: Record<string, string> = {
  parser: "document parser",
  scanner: "candidate scanner",
  extractor: "obligation extractor",
  anchorer: "quote anchorer",
  grammar: "date parser",
  resolver: "date resolver",
  evaluator: "support evaluator",
  router: "lane router",
  review: "review workflow",
};

function StaleBanner({
  engineVersions,
  dvId,
  onReanalysed,
}: {
  engineVersions: EngineVersions;
  dvId: string;
  onReanalysed: () => void;
}) {
  const [reanalysing, setReanalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (engineVersions.staleStages.length === 0) return null;

  const hasSpecificStages =
    engineVersions.staleStages.length > 0 &&
    !engineVersions.staleStages.includes("unknown");
  const stageNames = hasSpecificStages
    ? engineVersions.staleStages.map((s) => STAGE_DISPLAY[s] ?? s).join(", ")
    : null;

  const parserIsStale = engineVersions.staleStages.includes("parser");

  const handleReanalyse = async (forceReparse = false) => {
    setReanalysing(true);
    setError(null);
    try {
      for await (const event of streamAnalysis(dvId, undefined, { forceReparse })) {
        if (event.stage === "complete") break;
        if (event.status === "failed") {
          setError(event.error ?? "Re-analysis failed");
          setReanalysing(false);
          return;
        }
      }
      setReanalysing(false);
      onReanalysed();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Re-analysis failed";
      if (msg.includes("ACCEPTED_RECORDS_EXIST")) {
        setError("Cannot re-extract: accepted findings must be reverted first.");
      } else {
        setError(msg);
      }
      setReanalysing(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            {parserIsStale
              ? "This document was extracted with an older version of the parser."
              : "This analysis used an earlier version of the engine."}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {stageNames
              ? `Updated since this analysis: ${stageNames}.`
              : "The engine has been updated since this analysis was run."}{" "}
            {parserIsStale
              ? "Re-extract from source to apply parser improvements."
              : "Re-analyse to get results from the current engine."}
          </p>
          {error && (
            <p className="mt-1 text-xs text-red-700">{error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleReanalyse(parserIsStale)}
          disabled={reanalysing}
          className="flex-shrink-0 rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {reanalysing
            ? (parserIsStale ? "Re-extracting…" : "Re-analysing…")
            : (parserIsStale ? "Re-extract from source" : "Re-analyse")}
        </button>
      </div>
    </div>
  );
}

// ─── Tab Config ───

const TABS: { key: Tab; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "owner", label: "By owner" },
  { key: "calendar", label: "Calendar" },
  { key: "summary", label: "Summary" },
];

// ─── Page ───

export default function PlanPage({
  params,
}: {
  params: Promise<{ dvId: string }>;
}) {
  const { dvId } = use(params);
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) ?? "timeline";
  const [data, setData] = useState<FindingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    fetchFindings(dvId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [dvId]);

  const refreshData = async () => {
    const refreshed = await fetchFindings(dvId);
    setData(refreshed);
  };

  const handleSupply = async (
    anchorId: string,
    deadlineDate: string,
  ) => {
    await supplyInput(dvId, anchorId, "demo-user", {
      deadlineDate,
    });
    await refreshData();
  };

  const handleEditDate = async (
    anchorId: string,
    deadlineDate: string,
  ) => {
    await editRecordDate(dvId, anchorId, "demo-user", deadlineDate);
    await refreshData();
  };

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-gray-500">Loading plan…</p>;
  }

  const findings = data.findings;
  const title = formatDocumentTitle(data.legalIdentity);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Compliance Plan
          </h1>
          <a
            href={`/api/v1/documents/${dvId}/source`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            View source document
          </a>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {findings.length} obligations &middot; {title}
        </p>
      </div>

      {data.engineVersions &&
        data.engineVersions.staleStages.length > 0 && (
          <StaleBanner
            engineVersions={data.engineVersions}
            dvId={dvId}
            onReanalysed={refreshData}
          />
        )}

      <JurisdictionLimitationNotice jurisdiction={data.legalIdentity.jurisdiction} />

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={classNames(
                "whitespace-nowrap border-b-2 pb-3 pt-1 text-sm font-medium",
                tab === t.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "timeline" && (
        <TimelineView findings={findings} onSupply={handleSupply} onEditDate={handleEditDate} />
      )}
      {tab === "owner" && (
        <OwnerView findings={findings} onSupply={handleSupply} onEditDate={handleEditDate} />
      )}
      {tab === "calendar" && <CalendarView findings={findings} />}
      {tab === "summary" && (
        <SummaryView
          findings={findings}
          legalIdentity={data.legalIdentity}
        />
      )}
    </div>
  );
}
