import type { Finding, StageEvent } from "./api";

export function formatUnresolvedReason(f: Finding): string {
  if (!f.grammarParsed) {
    return "This expression does not match a recognized date or duration pattern.";
  }
  if (f.refusalKind === "broken_cross_reference") {
    return f.unresolvedReason ?? "This deadline references a subsection whose content does not match the described trigger event.";
  }
  if (f.refusalKind === "nonexistent_trigger") {
    return f.unresolvedReason ?? "This deadline references a trigger event that does not exist in the cited subsection.";
  }
  if (f.unresolvedReason?.includes("hour-scale")) {
    return "This duration is measured in hours, not days — it cannot be resolved to a calendar date.";
  }
  if (f.unresolvedReason?.includes("no date anchor")) {
    return "This recurrence has no date anchor — cannot generate occurrences without a fixed month and day.";
  }
  if (f.unresolvedReason?.includes("legislative session")) {
    return "This recurrence is anchored to a legislative session — requires a session calendar to generate occurrences.";
  }
  if (f.unresolvedReason?.includes("enactment date not available")) {
    return "This deadline is measured from the date of enactment, which is not available for pending bills.";
  }
  if (f.unresolvedReason?.startsWith("runs from an event this document does not date:")) {
    const eventDesc = f.unresolvedReason.slice("runs from an event this document does not date: ".length);
    return `Runs from an undated event: ${eventDesc}.`;
  }
  if (f.unresolvedReason?.startsWith("runs from an event this bill does not date:")) {
    const eventDesc = f.unresolvedReason.slice("runs from an event this bill does not date: ".length);
    return `Runs from an undated event: ${eventDesc}.`;
  }
  if (f.unresolvedReason?.includes("bounded by")) {
    return f.unresolvedReason.replace(/\s*—\s*bounded by/, ". Upper bound:");
  }
  if (f.missingInputs?.includes("enactmentDate")) {
    return "This deadline runs from the date of enactment, which is not available for this document.";
  }
  if (f.missingInputs?.includes("triggerDate")) {
    return "This deadline runs from an event this document does not date.";
  }
  if (f.unresolvedReason?.includes("No jurisdiction pack available")) {
    return "Statutory date computation is not yet supported for this jurisdiction.";
  }
  if (f.unresolvedReason?.includes("year not specified")) {
    return "The year is not specified in this date expression.";
  }
  if (f.unresolvedReason) {
    return f.unresolvedReason;
  }
  return "Could not be automatically resolved.";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatRruleSchedule(rrule: string): string {
  const parts = new Map(rrule.split(";").map((p) => {
    const [k, v] = p.split("=");
    return [k, v] as [string, string];
  }));

  const freq = parts.get("FREQ");
  const interval = parseInt(parts.get("INTERVAL") ?? "1", 10);
  const byMonth = parts.get("BYMONTH");
  const byMonthDay = parts.get("BYMONTHDAY");

  const monthStr = byMonth ? MONTH_NAMES[parseInt(byMonth, 10) - 1] : null;
  const dayStr = byMonthDay ?? null;

  let base: string;
  if (freq === "YEARLY" && interval === 2) {
    base = "every two years";
  } else if (freq === "YEARLY" && interval === 1) {
    base = "every year";
  } else if (freq === "MONTHLY" && interval === 3) {
    base = "every quarter";
  } else if (freq === "MONTHLY") {
    base = interval > 1 ? `every ${interval} months` : "every month";
  } else if (freq === "WEEKLY") {
    base = interval > 1 ? `every ${interval} weeks` : "every week";
  } else if (freq === "DAILY") {
    base = interval > 1 ? `every ${interval} days` : "every day";
  } else {
    base = `every ${interval > 1 ? interval + " " : ""}${(freq ?? "year").toLowerCase()}s`;
  }

  if (monthStr && dayStr) {
    return `${base} on ${monthStr} ${dayStr}`;
  }
  if (monthStr) {
    return `${base} in ${monthStr}`;
  }
  if (dayStr) {
    return `${base} on day ${dayStr}`;
  }
  return base;
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

const KIND_LABELS: Record<string, string> = {
  temporal_constraint: "recurring obligation",
  obligation_deadline: "deadline",
};

export function formatKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

const GENERIC_ACTOR_NAMES = new Set([
  "agency", "department", "office", "bureau", "commission",
  "board", "authority", "entity", "body", "organization",
  "person", "individual", "party", "applicant", "recipient",
]);

export function isGenericActor(actor: string): boolean {
  return GENERIC_ACTOR_NAMES.has(actor.toLowerCase().trim());
}

export function formatActorDisplay(actor: string | null): {
  text: string;
  isPlaceholder: boolean;
} {
  if (!actor) {
    return {
      text: "Accountable party not identified in this provision",
      isPlaceholder: true,
    };
  }
  if (isGenericActor(actor)) {
    return {
      text: "Accountable party not identified in this provision",
      isPlaceholder: true,
    };
  }
  return { text: actor, isPlaceholder: false };
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
