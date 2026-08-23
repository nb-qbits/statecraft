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

export const RESOLVER_VERSION = "1.6.0";

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
    case "calendar_year_anchored_date":
      return resolveCalendarYearAnchoredDate(expression, suppliedInputs, pack);
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
      refusalKind: "missing_year",
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
    capDate?: { month: number; day: number; year: number; capKind: "sooner" | "later" }
      | { month: number; day: number; yearSource: "dependency_ref"; dependencyRef: string; yearOffset: number; capKind: "sooner" | "later" };
  },
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
  derivedEffectiveDate?: DerivedEffectiveDate,
): ResolutionResult {
  let triggerInput = suppliedInputs.find((i) => i.name === "triggerDate");

  const referencesEffectiveDate =
    expression.referenceEvent === "effective_date";
  const referencesEnactment =
    expression.referenceEvent === "enactment" ||
    expression.referenceEvent === "passage";

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

  if (!triggerInput && referencesEnactment) {
    const enactmentInput = suppliedInputs.find((i) => i.name === "enactmentDate");
    if (enactmentInput) {
      derivedInput = enactmentInput;
      triggerInput = { ...enactmentInput, name: "triggerDate" };
    }
  }

  if (!triggerInput) {
    const warnings: string[] = [];

    if (expression.referenceEvent) {
      warnings.push(
        `expression references '${expression.referenceEvent}' but no triggerDate was supplied`,
      );
    }

    const hasEventRef = referencesEnactment || expression.referenceEventText;
    const refusalKind = hasEventRef ? "undated_event" as const : "missing_trigger" as const;
    const reason = referencesEnactment
      ? "enactment date not available for this document"
      : expression.referenceEventText
        ? `runs from an event this document does not date: ${expression.referenceEventText}`
        : "triggerDate is required to resolve a relative duration";

    if (expression.capDate) {
      if ("yearSource" in expression.capDate) {
        return {
          resolved: false,
          refusalKind: "unresolved_dependency" as const,
          reason: `cap date depends on ${expression.capDate.dependencyRef} which has not been resolved`,
          missingInputs: [`dependencyRef:${expression.capDate.dependencyRef}`],
          warnings,
          inputs: [...suppliedInputs],
        };
      }
      const { month, day, year, capKind } = expression.capDate;
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const upperBound = `${year}-${mm}-${dd}`;
      return {
        resolved: false,
        bounded: true,
        upperBound,
        reason: `${reason} — bounded by ${capKind === "sooner" ? "on or before" : "on or after"} ${upperBound}`,
        missingInputs: referencesEnactment ? ["enactmentDate"] : ["triggerDate"],
        warnings,
        inputs: [...suppliedInputs],
      };
    }

    return {
      resolved: false,
      refusalKind,
      reason,
      missingInputs: referencesEnactment ? ["enactmentDate"] : ["triggerDate"],
      warnings,
      inputs: [...suppliedInputs],
    };
  }

  if (expression.unit === "hours") {
    return {
      resolved: false,
      refusalKind: "hour_scale",
      reason:
        "hour-scale durations cannot be resolved to a civil date — they require time-of-day computation",
      missingInputs: [],
      warnings: [],
      inputs: [triggerInput],
    };
  }

  let deadline: { statutoryDate: string; adjustedDate: string; ruleIds: readonly string[]; citations: readonly string[] };

  if (expression.unit === "months" || expression.unit === "years") {
    const trigger = new Date(triggerInput.value + "T00:00:00Z");
    const monthsToAdd = expression.unit === "years"
      ? expression.quantity * 12
      : expression.quantity;
    const target = new Date(Date.UTC(
      trigger.getUTCFullYear(),
      trigger.getUTCMonth() + monthsToAdd,
      trigger.getUTCDate(),
    ));
    const statutoryDate = target.toISOString().slice(0, 10);
    const adjustment = pack.adjustForNonBusinessDay(statutoryDate);
    deadline = {
      statutoryDate,
      adjustedDate: adjustment.adjustedDate,
      ruleIds: [`${expression.quantity}-${expression.unit}-from-trigger`, ...adjustment.ruleIds],
      citations: [`${expression.quantity} ${expression.unit} after ${triggerInput.value}`, ...adjustment.citations],
    };
  } else {
    const dayKind = (expression.dayKind ?? "calendar") as
      | "calendar"
      | "business"
      | "working";
    deadline = pack.computeDeadline(
      triggerInput.value,
      expression.quantity,
      dayKind,
    );
  }

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

  let finalStatutory = deadline.statutoryDate;
  let finalAdjusted = deadline.adjustedDate;

  if (expression.capDate && !("yearSource" in expression.capDate)) {
    const { month, day, year, capKind } = expression.capDate;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    const capIso = `${year}-${mm}-${dd}`;

    const useCap = capKind === "sooner"
      ? capIso < finalStatutory
      : capIso > finalStatutory;

    if (useCap) {
      finalStatutory = capIso;
      const capAdj = pack.adjustForNonBusinessDay(capIso);
      finalAdjusted = capAdj.adjustedDate;
      ruleIds.push("cap-date-applied");
      citations.push(`capped at ${capIso} (whichever is ${capKind})`);
      ruleIds.push(...capAdj.ruleIds);
      citations.push(...capAdj.citations);
    }
  }

  return {
    resolved: true,
    statutoryDate: finalStatutory,
    adjustedDate: finalAdjusted,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs,
  };
}

function resolveCalendarYearAnchoredDate(
  expression: {
    kind: "calendar_year_anchored_date";
    month: number;
    day: number;
    calendarYearOffset: number;
    referenceEvent: string | null;
    referenceEventText: string | null;
  },
  suppliedInputs: readonly ResolutionInput[],
  pack: JurisdictionPack,
): ResolutionResult {
  const referencesEnactment =
    expression.referenceEvent === "enactment" ||
    expression.referenceEvent === "passage";

  let triggerInput = suppliedInputs.find((i) => i.name === "triggerDate");

  if (!triggerInput && referencesEnactment) {
    const enactmentInput = suppliedInputs.find((i) => i.name === "enactmentDate");
    if (enactmentInput) {
      triggerInput = { ...enactmentInput, name: "triggerDate" };
    }
  }

  if (!triggerInput && expression.referenceEvent === "effective_date") {
    const effectiveInput = suppliedInputs.find((i) => i.name === "effectiveDate");
    if (effectiveInput) {
      triggerInput = { ...effectiveInput, name: "triggerDate" };
    }
  }

  if (!triggerInput) {
    const hasEventRef = referencesEnactment || expression.referenceEventText;
    return {
      resolved: false,
      refusalKind: hasEventRef ? "undated_event" as const : "missing_trigger" as const,
      reason: referencesEnactment
        ? "enactment date not available for this document"
        : expression.referenceEventText
          ? `runs from an event this document does not date: ${expression.referenceEventText}`
          : "reference date is required to resolve calendar year offset",
      missingInputs: referencesEnactment ? ["enactmentDate"] : ["triggerDate"],
      warnings: [],
      inputs: [...suppliedInputs],
    };
  }

  const refDate = new Date(triggerInput.value + "T00:00:00Z");
  const refYear = refDate.getUTCFullYear();
  const targetYear = refYear + expression.calendarYearOffset;

  const maxDays = new Date(targetYear, expression.month, 0).getDate();
  if (expression.day > maxDays) {
    return {
      resolved: false,
      refusalKind: "missing_trigger" as const,
      reason: `day ${expression.day} invalid for month ${expression.month} in year ${targetYear}`,
      missingInputs: [],
      warnings: [],
      inputs: [triggerInput],
    };
  }

  const mm = String(expression.month).padStart(2, "0");
  const dd = String(expression.day).padStart(2, "0");
  const statutoryDate = `${targetYear}-${mm}-${dd}`;

  const adjustment = pack.adjustForNonBusinessDay(statutoryDate);

  const ordinals = ["", "first", "second", "third", "fourth", "fifth"];
  const ordinalWord = ordinals[expression.calendarYearOffset] ?? `${expression.calendarYearOffset}th`;

  return {
    resolved: true,
    statutoryDate,
    adjustedDate: adjustment.adjustedDate,
    ruleIds: ["calendar-year-offset", ...adjustment.ruleIds],
    citations: [
      `${ordinalWord} calendar year after ${triggerInput.value} = ${targetYear}`,
      ...adjustment.citations,
    ],
    packVersion: pack.packVersion,
    warnings: [],
    inputs: [triggerInput],
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
      refusalKind: "missing_anchor",
      reason: "recurrence has no date anchor — cannot generate occurrences without a start date",
      missingInputs: ["anchorDate"],
      warnings: [],
      inputs: [...suppliedInputs],
    };
  }

  if (expression.anchorEvent === "regular_session") {
    return {
      resolved: false,
      refusalKind: "missing_anchor",
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
