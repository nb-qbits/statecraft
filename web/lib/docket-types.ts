import type { Finding, FindingsResponse, LegalIdentity } from "./api";
import { isGenericActor } from "./format";

export type Determination = "computed" | "reviewer" | "unresolved";

export type TaskStatus =
  | "overdue"
  | "needs_input"
  | "due_soon"
  | "upcoming"
  | "completed";

export interface DocketTask {
  anchorId: string;
  segmentId: string;
  determination: Determination;
  obligation: string;
  citation: string;
  actor: string | null;
  actorQuotedText: string | null;
  contingent: boolean;
  due: string | null;
  statutoryDate: string | null;
  adjustedDate: string | null;
  rrule: string | null;
  completed: boolean;
  computedNote: string;
  reviewerName: string | null;
  unresolvedReason: string;
  inputAsk: string;
  ruleIds: string[];
  citations: string[];
  packVersion: string | null;
  referenceEventText: string | null;
  status: TaskStatus;
  billDvId: string;
  billNumber: string;
}

export interface DocketBill {
  dvId: string;
  legalIdentity: LegalIdentity;
  title: string;
  number: string;
  jurisdiction: string;
  session: string;
  addedDate: string;
  tasks: DocketTask[];
  coverage: FindingsResponse["coverage"];
}

export interface StatusCounts {
  overdue: number;
  needs_input: number;
  due_soon: number;
  upcoming: number;
  completed: number;
  total: number;
}

export function deriveDetermination(f: Finding): Determination {
  if (!f.resolved) return "unresolved";
  if (f.citations.some((c) => c.startsWith("reviewer_asserted:"))) return "reviewer";
  return "computed";
}

export function deriveTaskStatus(
  determination: Determination,
  due: string | null,
  accepted: boolean,
): TaskStatus {
  if (determination === "unresolved") return "needs_input";
  if (accepted) return "completed";
  if (!due) return "upcoming";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return "overdue";
  const soon = new Date();
  soon.setDate(soon.getDate() + 21);
  const soonStr = soon.toISOString().slice(0, 10);
  if (due <= soonStr) return "due_soon";
  return "upcoming";
}

export function deriveComputedNote(f: Finding): string {
  const relevant = f.citations.filter(
    (c) =>
      !c.startsWith("recurrence rule:") &&
      !c.startsWith("year parity:") &&
      !c.startsWith("reviewer_asserted:"),
  );
  if (relevant.length === 0) {
    if (f.rrule) return "Recurring schedule computed";
    return "Date computed";
  }
  return relevant.join(" · ");
}

export function deriveUnresolvedReason(f: Finding): string {
  if (f.unresolvedReason) {
    return formatUnresolvedReasonText(f.unresolvedReason, f);
  }
  if (f.missingInputs && f.missingInputs.length > 0) {
    return `Missing: ${f.missingInputs.join(", ")}`;
  }
  return "Could not compute date";
}

function formatUnresolvedReasonText(reason: string, f: Finding): string {
  if (reason === "missing_trigger_date" || reason === "trigger_date_unknown") {
    if (f.referenceEventText) {
      return `Runs from an event this bill does not date: ${f.referenceEventText}`;
    }
    return "Depends on a triggering event whose date is not stated in this document";
  }
  if (reason === "missing_year") {
    return "Date includes month and day but no year — needs a legislative session year";
  }
  if (reason === "effective_date_unresolved") {
    return "Depends on the effective date, which could not be determined";
  }
  if (reason === "no resolution attempted") {
    return "Expression recognized but date computation was not attempted";
  }
  if (reason.includes("jurisdiction pack")) {
    return "No jurisdiction-specific rules available for date computation";
  }
  return reason.replace(/_/g, " ");
}

export function deriveInputAsk(f: Finding): string {
  if (f.referenceEventText) {
    return `When did "${f.referenceEventText}" occur?`;
  }
  return "This document does not name what starts this clock.";
}

export function findingToDocketTask(
  f: Finding,
  billDvId: string,
  billNumber?: string,
): DocketTask {
  const determination = deriveDetermination(f);
  const due = f.adjustedDate ?? f.statutoryDate
    ?? (f.occurrences.length > 0 ? f.occurrences[0].adjustedDate : null);
  const accepted = f.status === "accepted";
  const status = deriveTaskStatus(determination, due, accepted);

  return {
    anchorId: f.anchorId,
    segmentId: f.segmentId,
    determination,
    obligation: f.obligationTitle
      ?? (f.quotedText.length > 120 ? f.quotedText.slice(0, 117) + "..." : f.quotedText),
    citation: f.sectionCitation ?? (f.provisionLabel || f.structuralPath || ""),
    actor: f.actor && !isGenericActor(f.actor) ? f.actor : null,
    actorQuotedText: f.actorQuotedText ?? null,
    contingent: !!(f.referenceEventText && f.missingInputs?.includes("triggerDate")),
    due,
    statutoryDate: f.statutoryDate,
    adjustedDate: f.adjustedDate,
    rrule: f.rrule,
    completed: accepted,
    computedNote: deriveComputedNote(f),
    reviewerName: determination === "reviewer" ? "Reviewer" : null,
    unresolvedReason: deriveUnresolvedReason(f),
    inputAsk: deriveInputAsk(f),
    ruleIds: f.ruleIds,
    citations: f.citations,
    packVersion: f.packVersion,
    referenceEventText: f.referenceEventText,
    status,
    billDvId,
    billNumber: billNumber ?? "",
  };
}

export function countStatuses(tasks: DocketTask[]): StatusCounts {
  const counts: StatusCounts = {
    overdue: 0,
    needs_input: 0,
    due_soon: 0,
    upcoming: 0,
    completed: 0,
    total: tasks.length,
  };
  for (const t of tasks) {
    counts[t.status]++;
  }
  return counts;
}

export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  overdue: {
    label: "Overdue",
    color: "#B8452F",
    bg: "#FBEAE5",
    dot: "#B8452F",
  },
  needs_input: {
    label: "Needs input",
    color: "#5B5B8C",
    bg: "#EFEDF7",
    dot: "#8377B0",
  },
  due_soon: {
    label: "Due soon",
    color: "#A67326",
    bg: "#FBF1DF",
    dot: "#A67326",
  },
  upcoming: {
    label: "Upcoming",
    color: "#3C5A82",
    bg: "#EAF0F8",
    dot: "#4C6D96",
  },
  completed: {
    label: "Completed",
    color: "#3F6B54",
    bg: "#E9F2EC",
    dot: "#3F6B54",
  },
};

export function daysUntilLabel(due: string | null, status: TaskStatus): string {
  if (!due) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(due + "T00:00:00");
  const diffMs = target.getTime() - today.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (status === "completed") return "Done";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d to next deadline`;
}

export function provenanceFor(task: DocketTask) {
  const found = {
    actor: "AI",
    label: "Identified candidate obligation",
    result: `Found matching phrase in ${task.citation || "source text"}`,
  };
  const verified = {
    actor: "System",
    label: "Verified quote against source text",
    result: "Exact match confirmed",
  };
  if (task.determination === "computed") {
    return [
      found,
      verified,
      { actor: "System", label: "Computed date", result: task.computedNote },
    ];
  }
  if (task.determination === "reviewer") {
    return [
      found,
      verified,
      {
        actor: "System",
        label: "Attempted computation",
        result: "Blocked — required input not stated in text",
      },
      {
        actor: "Person",
        label: `Date entered by ${task.reviewerName}`,
        result: task.due
          ? new Date(task.due + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—",
      },
    ];
  }
  return [
    found,
    verified,
    {
      actor: "System",
      label: "Attempted computation",
      result: task.unresolvedReason,
    },
  ];
}

export function provenanceSummary(task: DocketTask): string {
  if (task.determination === "computed") {
    const ruleCount = task.ruleIds.length;
    return ruleCount > 1
      ? `AI found · verified · computed (${ruleCount} rules)`
      : "AI found · verified · computed";
  }
  if (task.determination === "reviewer") {
    return `AI found · verified · entered by ${task.reviewerName}`;
  }
  return "AI found · verified · needs input";
}

export function getAgencyInitials(name: string): string {
  const skip = new Set(["of", "the", "and", "for"]);
  const words = name
    .replace(/[.&]/g, "")
    .split(" ")
    .filter((w) => w && !skip.has(w.toLowerCase()));
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
