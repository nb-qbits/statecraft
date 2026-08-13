import type { JurisdictionPack } from "../jurisdiction/types.js";
import type {
  ParsedAnchoredExpression,
  ResolutionInput,
  ResolutionResult,
  DerivedEffectiveDate,
} from "./types.js";

export const RESOLVER_VERSION = "1.1.0";

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
      return resolveRecurrence(expression, suppliedInputs);
  }
}

function resolveFixedDate(
  expression: { kind: "fixed_date"; month: number; day: number; year: number },
  expr: ParsedAnchoredExpression,
  pack: JurisdictionPack,
): ResolutionResult {
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

  if (adjustment.wasAdjusted) {
    ruleIds.push(...adjustment.ruleIds);
    citations.push(...adjustment.citations);
  } else {
    ruleIds.push("va-1-210-E-evaluated-no-adjustment");
    citations.push("Va. Code § 1-210(E) evaluated — date falls on a business day, no adjustment required");
  }

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

    return {
      resolved: false,
      reason: "triggerDate is required to resolve a relative duration",
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
  _expression: {
    kind: "recurrence";
    frequency: string;
    quantity: number;
    unit: string;
    dayKind: string | null;
  },
  suppliedInputs: readonly ResolutionInput[],
): ResolutionResult {
  return {
    resolved: false,
    reason:
      "recurrence expressions produce repeating obligations, not a single deadline date",
    missingInputs: ["periodStart", "periodEnd"],
    warnings: [],
    inputs: [...suppliedInputs],
  };
}
