import type { Finding, StageEvent } from "./api";

export function formatUnresolvedReason(f: Finding): string {
  if (!f.grammarParsed) {
    return "This expression does not match a recognized date or duration pattern.";
  }
  if (f.missingInputs?.includes("triggerDate")) {
    return "This deadline runs from an event this bill does not date.";
  }
  if (f.unresolvedReason?.includes("hour-scale")) {
    return "This duration is measured in hours, not days — it cannot be resolved to a calendar date.";
  }
  if (f.unresolvedReason?.includes("recurrence")) {
    return "This is a repeating obligation, not a single deadline.";
  }
  if (f.unresolvedReason) {
    return f.unresolvedReason;
  }
  return "Could not be automatically resolved.";
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[parseInt(month!, 10) - 1]} ${parseInt(day!, 10)}, ${year}`;
}

export function formatCitation(citation: string): string {
  return citation
    .replace(/^date stated in instrument: '.*'$/, "date stated in instrument")
    .replace(/Va\. Code §/g, "Va. Code §");
}

const STAGE_LABELS: Record<string, string> = {
  parsed: "Parsed",
  scanned: "Scanned",
  proposed: "Proposed",
  verified: "Verified",
  parsedDates: "Parsed dates",
  resolved: "Resolved",
  evaluated: "Evaluated",
  routed: "Routed",
  complete: "Complete",
};

const COUNT_LABELS: Record<string, string> = {
  provisions: "provisions",
  candidateExpressions: "candidate expressions",
  suppressed: "suppressed",
  spansIdentified: "spans identified",
  anchoredToSource: "anchored to source",
  rejected: "rejected — quote not found in document",
  overExtractionSuppressed: "suppressed duplicate fragments",
  duplicateSpansSuppressed: "duplicate spans collapsed",
  expressionsUnderstood: "expressions understood",
  parseFailed: "could not be parsed",
  datesComputed: "dates computed",
  needTriggerDate: "need a trigger date",
  readyToConfirm: "ready to confirm",
  needReview: "need review",
  blocked: "blocked",
  exception_review: "need exception review",
  straight_through: "straight through",
  quick_confirmation: "quick confirmation",
};

export function formatStageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function formatStageCounts(event: StageEvent): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(event.counts)) {
    if (value === 0 && key === "suppressed") continue;
    const label = COUNT_LABELS[key] ?? key;
    parts.push(`${value} ${label}`);
  }
  return parts.join(" · ");
}

export function formatLane(lane: string): string {
  switch (lane) {
    case "exception_review":
      return "Findings requiring review";
    case "blocked":
      return "Could not be resolved";
    case "quick_confirmation":
      return "Ready for quick confirmation";
    case "straight_through":
      return "Automatically resolved";
    default:
      return lane;
  }
}

export function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

export function formatRejectionReason(reason: string): string {
  switch (reason) {
    case "fuzzy_ceiling_exceeded":
      return "The quoted text could not be found in the document, even with approximate matching.";
    case "no_match":
      return "The quoted text does not appear in the document.";
    case "empty_quote":
      return "The model returned an empty quote.";
    case "empty_segment":
      return "The source segment has no text to match against.";
    case "empty_after_normalization":
      return "The quoted text reduced to nothing after normalization.";
    case "segment_not_found":
      return "The model referenced a segment that does not exist in the document.";
    default:
      return "Could not verify this quote against the document text.";
  }
}
