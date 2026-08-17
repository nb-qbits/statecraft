import rruleLib from "rrule";
const { RRule, Frequency } = rruleLib;
import type { JurisdictionPack } from "../jurisdiction/types.js";
import type { RecurrenceExpression } from "../grammar/types.js";
import type {
  ParsedAnchoredExpression,
  ResolutionInput,
  ResolutionResult,
  Occurrence,
  DerivedEffectiveDate,
} from "./types.js";

const DEFAULT_HORIZON_YEARS = 5;

function nearestEvenYear(year: number): number {
  return year % 2 === 0 ? year : year + 1;
}

function nearestOddYear(year: number): number {
  return year % 2 === 1 ? year : year + 1;
}

function toRRuleString(expr: RecurrenceExpression): string {
  const parts: string[] = [];

  switch (expr.frequency) {
    case "yearly":
      parts.push("FREQ=YEARLY");
      break;
    case "quarterly":
      parts.push("FREQ=MONTHLY");
      break;
    case "monthly":
      parts.push("FREQ=MONTHLY");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY");
      break;
    case "daily":
      parts.push("FREQ=DAILY");
      break;
  }

  if (expr.frequency === "quarterly") {
    parts.push("INTERVAL=3");
  } else if (expr.yearParity) {
    parts.push("INTERVAL=2");
  } else if (expr.interval > 1) {
    parts.push(`INTERVAL=${expr.interval}`);
  }

  if (expr.byMonth !== null) {
    parts.push(`BYMONTH=${expr.byMonth}`);
  }
  if (expr.byMonthDay !== null) {
    parts.push(`BYMONTHDAY=${expr.byMonthDay}`);
  }

  return parts.join(";");
}

function rruleFrequency(freq: string): typeof Frequency[keyof typeof Frequency] {
  switch (freq) {
    case "yearly": return Frequency.YEARLY;
    case "quarterly": return Frequency.MONTHLY;
    case "monthly": return Frequency.MONTHLY;
    case "weekly": return Frequency.WEEKLY;
    case "daily": return Frequency.DAILY;
    default: return Frequency.YEARLY;
  }
}

function generateOccurrences(
  expr: RecurrenceExpression,
  _rruleStr: string,
  dtstart: Date,
  horizonYears: number,
  pack: JurisdictionPack,
): Occurrence[] {
  const until = new Date(Date.UTC(
    dtstart.getUTCFullYear() + horizonYears,
    dtstart.getUTCMonth(),
    dtstart.getUTCDate(),
  ));

  const interval = expr.frequency === "quarterly"
    ? 3
    : expr.yearParity
      ? 2
      : expr.interval;

  const rule = new RRule({
    freq: rruleFrequency(expr.frequency),
    interval,
    dtstart,
    until,
    bymonth: expr.byMonth !== null ? [expr.byMonth] : null,
    bymonthday: expr.byMonthDay !== null ? [expr.byMonthDay] : null,
  });

  const dates = rule.all();

  return dates.map((d, i) => {
    const isoDate = d.toISOString().slice(0, 10);
    const adjustment = pack.adjustForNonBusinessDay(isoDate);

    const occRuleIds: string[] = [];
    const occCitations: string[] = [];

    occRuleIds.push(...adjustment.ruleIds);
    occCitations.push(...adjustment.citations);

    return {
      occurrenceDate: isoDate,
      adjustedDate: adjustment.adjustedDate,
      ruleIds: occRuleIds,
      citations: occCitations,
      sequenceNumber: i + 1,
    };
  });
}

export const RESOLVER_VERSION = "1.2.0";

export function resolve(
  expr: ParsedAnchoredExpression,
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
  derivedEffectiveDate?: DerivedEffectiveDate,
): ResolutionResult {
  const { expression } = expr;

  switch (expression.kind) {
    case "fixed_date":
      return resolveFixedDate(expression, expr, pack);
    case "relative_duration":
      return resolveRelativeDuration(expression, suppliedInputs, pack, derivedEffectiveDate);
    case "recurrence":
      return resolveRecurrence(expression, suppliedInputs, pack);
  }
}

function resolveFixedDate(
  expression: { kind: "fixed_date"; month: number; day: number; year: number | null },
  expr: ParsedAnchoredExpression,
  pack: JurisdictionPack,
): ResolutionResult {
  if (expression.year === null) {
    return {
      resolved: false,
      reason: "year not specified in expression",
      missingInputs: ["year"],
      warnings: [],
      inputs: [],
    };
  }

  const mm = String(expression.month).padStart(2, "0");
  const dd = String(expression.day).padStart(2, "0");
  const statutoryDate = `${expression.year}-${mm}-${dd}`;

  const input: ResolutionInput = {
    name: "specifiedDate",
    value: statutoryDate,
    source: "anchored_span",
    authority: "act_text",
    citation: `quoted text: '${expr.text}'`,
  };

  const adjustment = pack.adjustForNonBusinessDay(statutoryDate);

  const ruleIds: string[] = ["verbatim-date"];
  const citations: string[] = [`date stated in instrument: '${expr.text}'`];

  ruleIds.push(...adjustment.ruleIds);
  citations.push(...adjustment.citations);

  return {
    resolved: true,
    statutoryDate,
    adjustedDate: adjustment.adjustedDate,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs: [input],
  };
}

function resolveRelativeDuration(
  expression: {
    kind: "relative_duration";
    quantity: number;
    unit: string;
    dayKind: string | null;
    boundKind: string;
    preposition: string | null;
    referenceEvent: string | null;
    referenceEventText?: string | null;
  },
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
  derivedEffectiveDate?: DerivedEffectiveDate,
): ResolutionResult {
  let triggerInput = suppliedInputs.find((i) => i.name === "triggerDate");

  const effectiveDateRefs = ["effective_date"];
  const referencesEffectiveDate =
    expression.referenceEvent !== null &&
    effectiveDateRefs.includes(expression.referenceEvent);

  let derivedInput: ResolutionInput | undefined;

  if (!triggerInput && referencesEffectiveDate && derivedEffectiveDate) {
    derivedInput = {
      name: "effectiveDate",
      value: derivedEffectiveDate.date,
      source: `derived: ${derivedEffectiveDate.citation} (adjournment: ${derivedEffectiveDate.sessionSource})`,
      authority: "jurisdiction_pack",
      citation: derivedEffectiveDate.citation,
    };
    triggerInput = { ...derivedInput, name: "triggerDate" };
  }

  if (!triggerInput) {
    const warnings: string[] = [];

    if (expression.referenceEvent) {
      warnings.push(
        `expression references '${expression.referenceEvent}' but no triggerDate was supplied`,
      );
    }

    const reason = expression.referenceEventText
      ? `runs from an event this bill does not date: ${expression.referenceEventText}`
      : "triggerDate is required to resolve a relative duration";

    return {
      resolved: false,
      reason,
      missingInputs: ["triggerDate"],
      warnings,
      inputs: [...suppliedInputs],
    };
  }

  if (expression.unit === "hours") {
    return {
      resolved: false,
      reason:
        "hour-scale durations cannot be resolved to a civil date — they require time-of-day computation",
      missingInputs: [],
      warnings: [],
      inputs: [triggerInput],
    };
  }

  const dayKind = (expression.dayKind ?? "calendar") as
    | "calendar"
    | "business"
    | "working";
  const deadline = pack.computeDeadline(
    triggerInput.value,
    expression.quantity,
    dayKind,
  );

  const ruleIds: string[] = [];
  const citations: string[] = [];

  if (derivedInput && derivedEffectiveDate) {
    ruleIds.push(derivedEffectiveDate.ruleId);
    citations.push(derivedEffectiveDate.citation);
  }

  ruleIds.push(...deadline.ruleIds);
  citations.push(...deadline.citations);

  const inputs: ResolutionInput[] = derivedInput
    ? [derivedInput]
    : [triggerInput];

  return {
    resolved: true,
    statutoryDate: deadline.statutoryDate,
    adjustedDate: deadline.adjustedDate,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs,
  };
}

function resolveRecurrence(
  expression: RecurrenceExpression,
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
): ResolutionResult {
  return resolveRecurrenceExpression(expression, suppliedInputs, pack);
}

function resolveRecurrenceExpression(
  expression: RecurrenceExpression,
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
): ResolutionResult {
  const needsAnchor =
    expression.anchorEvent === "regular_session" ||
    (expression.byMonth === null && expression.byMonthDay === null && expression.anchorEvent === null && !expression.anchorYear);

  if (needsAnchor && expression.anchorEvent !== "regular_session") {
    return {
      resolved: false,
      reason: "recurrence has no date anchor — cannot generate occurrences without a start date",
      missingInputs: ["anchorDate"],
      warnings: [],
      inputs: [...suppliedInputs],
    };
  }

  if (expression.anchorEvent === "regular_session") {
    return {
      resolved: false,
      reason: "recurrence anchored to legislative session — requires session calendar to generate occurrences",
      missingInputs: ["sessionDate"],
      warnings: [],
      inputs: [...suppliedInputs],
    };
  }

  const rruleStr = toRRuleString(expression);
  const horizon = DEFAULT_HORIZON_YEARS;
  const horizonEnd = `${new Date().getFullYear() + horizon}-12-31`;

  let startYear: number;
  if (expression.anchorYear != null) {
    startYear = expression.anchorYear;
    if (expression.yearParity === "even" && startYear % 2 !== 0) startYear++;
    else if (expression.yearParity === "odd" && startYear % 2 !== 1) startYear++;
  } else {
    startYear = expression.yearParity === "even"
      ? nearestEvenYear(new Date().getFullYear())
      : expression.yearParity === "odd"
        ? nearestOddYear(new Date().getFullYear())
        : new Date().getFullYear();
  }

  const dtstart = new Date(Date.UTC(
    startYear,
    (expression.byMonth ?? 1) - 1,
    expression.byMonthDay ?? 1,
  ));

  const occurrences = generateOccurrences(expression, rruleStr, dtstart, horizon, pack);

  const ruleIds = ["recurrence-schedule"];
  const citations = [`recurrence rule: ${rruleStr}`];

  if (expression.yearParity) {
    ruleIds.push("year-parity-filter");
    citations.push(`year parity: ${expression.yearParity}-numbered years only (RRULE INTERVAL=2 with DTSTART in ${expression.yearParity} year ${startYear})`);
  }

  return {
    resolved: true,
    recurrence: true,
    rrule: rruleStr,
    occurrences,
    horizon: horizonEnd,
    yearParityNote: expression.yearParity
      ? `${expression.yearParity}-numbered years — RRULE uses INTERVAL=2 with DTSTART=${dtstart.toISOString().slice(0, 10)} to achieve parity`
      : null,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs: [...suppliedInputs],
  };
}
