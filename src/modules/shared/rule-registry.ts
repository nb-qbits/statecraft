import { RESOLVER_VERSION } from "../resolver/resolve.js";
import { ANCHORER_VERSION } from "../anchoring/anchor.js";

const SIDECAR_VERSION = "1.3.0";
const VA_PACK_VERSION = "1.0.0";
const DEFAULT_PACK_VERSION = "1.0.0";

export interface StatutoryRule {
  readonly kind: "statutory";
  readonly ruleId: string;
  readonly authority: string;
  readonly description: string;
  readonly file: string;
  readonly version: string;
}

export interface ConventionRule {
  readonly kind: "convention";
  readonly ruleId: string;
  readonly description: string;
  readonly file: string;
  readonly version: string;
}

export type EngineRule = StatutoryRule | ConventionRule;

function statutory(
  ruleId: string,
  authority: string,
  description: string,
  file: string,
  version: string,
): StatutoryRule {
  return { kind: "statutory", ruleId, authority, description, file, version };
}

function convention(
  ruleId: string,
  description: string,
  file: string,
  version: string,
): ConventionRule {
  return { kind: "convention", ruleId, description, file, version };
}

// ---------------------------------------------------------------------------
// Rule ID constants — use these instead of inline strings
// ---------------------------------------------------------------------------

// Jurisdiction pack: Va. Code § 1-214 effective date rules
export const VA_1_214_A_DEFAULT = "va-1-214-A-default";
export const VA_1_214_A_SPECIFIED = "va-1-214-A-specified";
export const VA_1_214_B_DEFAULT = "va-1-214-B-default";
export const VA_1_214_B_SPECIFIED = "va-1-214-B-specified";
export const VA_1_214_C_DEFAULT = "va-1-214-C-default";
export const VA_1_214_C_SPECIFIED = "va-1-214-C-specified";
export const VA_1_214_D_DEFAULT = "va-1-214-D-default";
export const VA_1_214_D_SPECIFIED = "va-1-214-D-specified";
export const VA_1_214_E = "va-1-214-E";

// Jurisdiction pack: Va. Code § 1-210 time computation rules
export const VA_1_210_A = "va-1-210-A";
export const VA_1_210_E = "va-1-210-E";
export const VA_1_210_E_NO_ADJ = "va-1-210-E-evaluated-no-adjustment";
export const VA_1_210_F = "va-1-210-F";

// Default pack
export const GENERIC_DAY_AFTER_TRIGGER = "generic-day-after-trigger";

// Resolver: date-producing conventions
export const VERBATIM_DATE = "verbatim-date";
export const CALENDAR_YEAR_OFFSET = "calendar-year-offset";
export const CAP_DATE_APPLIED = "cap-date-applied";
export const RECURRENCE_SCHEDULE = "recurrence-schedule";
export const YEAR_PARITY_FILTER = "year-parity-filter";
export const ENACTMENT_DATE_APPROVED = "enactment-date-approved-clause";

// Resolver: refusal conventions
export const REFUSAL_UNDATED_EVENT = "refusal-undated-event";
export const REFUSAL_MISSING_TRIGGER = "refusal-missing-trigger";
export const REFUSAL_MISSING_YEAR = "refusal-missing-year";
export const REFUSAL_HOUR_SCALE = "refusal-hour-scale";
export const REFUSAL_MISSING_ANCHOR = "refusal-missing-anchor";
export const REFUSAL_CYCLE_DETECTED = "refusal-cycle-detected";
export const REFUSAL_UNRESOLVED_DEPENDENCY = "refusal-unresolved-dependency";
export const REFUSAL_BROKEN_CROSS_REFERENCE = "refusal-broken-cross-reference";
export const REFUSAL_NONEXISTENT_TRIGGER = "refusal-nonexistent-trigger";

// Resolver: bounding convention
export const TRANSITIVE_BOUND = "transitive-bound";

// Anchoring: suppression conventions
export const SUPPRESS_OVER_EXTRACTION = "suppress-over-extraction";
export const SUPPRESS_DUPLICATE_SPAN = "suppress-duplicate-span";

// Sidecar: text extraction conventions
export const SIDECAR_STRIP_RUNNING_HEADER = "sidecar-strip-running-header";
export const SIDECAR_STRIP_PAGE_FOOTER = "sidecar-strip-page-footer";
export const SIDECAR_STRIP_BACK_MATTER = "sidecar-strip-back-matter";
export const SIDECAR_STRIP_VERDATE = "sidecar-strip-verdate";
export const SIDECAR_STRIP_GPO_SYSTEM = "sidecar-strip-gpo-system";
export const SIDECAR_CLASSIFY_MARGINAL_NOTE = "sidecar-classify-marginal-note";

export function durationFromTriggerRuleId(quantity: number, unit: string): string {
  return `${quantity}-${unit}-from-trigger`;
}

// ---------------------------------------------------------------------------
// Map from RefusalKind to rule ID
// ---------------------------------------------------------------------------

export const REFUSAL_RULE_IDS: Record<string, string> = {
  undated_event: REFUSAL_UNDATED_EVENT,
  missing_trigger: REFUSAL_MISSING_TRIGGER,
  missing_year: REFUSAL_MISSING_YEAR,
  hour_scale: REFUSAL_HOUR_SCALE,
  missing_anchor: REFUSAL_MISSING_ANCHOR,
  cycle_detected: REFUSAL_CYCLE_DETECTED,
  unresolved_dependency: REFUSAL_UNRESOLVED_DEPENDENCY,
  broken_cross_reference: REFUSAL_BROKEN_CROSS_REFERENCE,
  nonexistent_trigger: REFUSAL_NONEXISTENT_TRIGGER,
};

// ---------------------------------------------------------------------------
// Full registry
// ---------------------------------------------------------------------------

export const RULE_REGISTRY: readonly EngineRule[] = [
  // Virginia effective date rules (statutory)
  statutory(VA_1_214_A_DEFAULT, "Va. Code § 1-214(A)", "Regular session: July 1 following adjournment", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_A_SPECIFIED, "Va. Code § 1-214(A)", "Regular session: subsequent date specified in the act", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_B_DEFAULT, "Va. Code § 1-214(B)", "Special session: first day of the fourth month following adjournment", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_B_SPECIFIED, "Va. Code § 1-214(B)", "Special session: subsequent date specified in the act", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_C_DEFAULT, "Va. Code § 1-214(C)", "General appropriation act: from passage", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_C_SPECIFIED, "Va. Code § 1-214(C)", "General appropriation act: date specified in the act", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_D_DEFAULT, "Va. Code § 1-214(D)", "Emergency act: from passage", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_D_SPECIFIED, "Va. Code § 1-214(D)", "Emergency act: subsequent date specified in the act", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),
  statutory(VA_1_214_E, "Va. Code § 1-214(E)", "Decennial reapportionment act: takes effect immediately", "src/modules/jurisdiction/effective-date.ts", VA_PACK_VERSION),

  // Virginia time computation rules (statutory)
  statutory(VA_1_210_A, "Va. Code § 1-210(A)", "Day of triggering event not counted", "src/modules/jurisdiction/time-computation.ts", VA_PACK_VERSION),
  statutory(VA_1_210_E, "Va. Code § 1-210(E)", "Non-business day: roll forward to next business day", "src/modules/jurisdiction/time-computation.ts", VA_PACK_VERSION),
  statutory(VA_1_210_E_NO_ADJ, "Va. Code § 1-210(E)", "Non-business day rule evaluated — date already falls on a business day", "src/modules/jurisdiction/time-computation.ts", VA_PACK_VERSION),
  statutory(VA_1_210_F, "Va. Code § 1-210(F)", "Governor-authorized closing day is a legal holiday", "packs/us-va/v1/rules.json", VA_PACK_VERSION),

  // Default pack (convention)
  convention(GENERIC_DAY_AFTER_TRIGGER, "Day of triggering event not counted (common convention, unverified for any specific jurisdiction)", "packs/default/v1/rules.json", DEFAULT_PACK_VERSION),

  // Resolver: date-producing conventions
  convention(VERBATIM_DATE, "Date stated literally in the instrument", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(CALENDAR_YEAR_OFFSET, "Nth calendar year after reference date", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(CAP_DATE_APPLIED, "Cap date comparison — whichever is sooner or later", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(RECURRENCE_SCHEDULE, "Recurrence schedule generated from RRULE", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(YEAR_PARITY_FILTER, "Odd/even year parity filtering for recurrences", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(ENACTMENT_DATE_APPROVED, "Enactment date extracted from 'Approved ...' clause in document text", "src/modules/resolver/enactment-date.ts", RESOLVER_VERSION),

  // Resolver: refusal conventions
  convention(REFUSAL_UNDATED_EVENT, "Refusal: expression references an event this document does not date", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_MISSING_TRIGGER, "Refusal: trigger date required but not supplied", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_MISSING_YEAR, "Refusal: year not specified in fixed date expression", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_HOUR_SCALE, "Refusal: hour-scale duration cannot be resolved to a civil date", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_MISSING_ANCHOR, "Refusal: recurrence has no date anchor", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_CYCLE_DETECTED, "Refusal: finding is part of a dependency cycle", "src/modules/resolver/service.ts", RESOLVER_VERSION),
  convention(REFUSAL_UNRESOLVED_DEPENDENCY, "Refusal: cap date depends on an unresolved subsection", "src/modules/resolver/resolve.ts", RESOLVER_VERSION),
  convention(REFUSAL_BROKEN_CROSS_REFERENCE, "Refusal: cross-referenced subsection does not match described actor/action", "src/modules/resolver/service.ts", RESOLVER_VERSION),
  convention(REFUSAL_NONEXISTENT_TRIGGER, "Refusal: trigger references a repeated occurrence that the subsection does not support", "src/modules/resolver/service.ts", RESOLVER_VERSION),

  // Resolver: bounding convention
  convention(TRANSITIVE_BOUND, "Transitive upper bound derived from a resolved or bounded dependency", "src/modules/resolver/service.ts", RESOLVER_VERSION),

  // Anchoring: suppression conventions
  convention(SUPPRESS_OVER_EXTRACTION, "Suppressed: span is a positional substring of a longer anchored span", "src/modules/anchoring/service.ts", ANCHORER_VERSION),
  convention(SUPPRESS_DUPLICATE_SPAN, "Suppressed: duplicate span at the same position or anchor ID", "src/modules/anchoring/service.ts", ANCHORER_VERSION),

  // Sidecar: text extraction conventions
  convention(SIDECAR_STRIP_RUNNING_HEADER, "Strip running headers (PUBLIC LAW, STAT., ACTS OF ASSEMBLY)", "sidecar/main.py", SIDECAR_VERSION),
  convention(SIDECAR_STRIP_PAGE_FOOTER, "Strip page footers (page numbers)", "sidecar/main.py", SIDECAR_VERSION),
  convention(SIDECAR_STRIP_BACK_MATTER, "Strip back matter (LEGISLATIVE HISTORY)", "sidecar/main.py", SIDECAR_VERSION),
  convention(SIDECAR_STRIP_VERDATE, "Strip VerDate system lines", "sidecar/main.py", SIDECAR_VERSION),
  convention(SIDECAR_STRIP_GPO_SYSTEM, "Strip GPO system lines (Jkt/Frm/Fmt/Sfmt)", "sidecar/main.py", SIDECAR_VERSION),
  convention(SIDECAR_CLASSIFY_MARGINAL_NOTE, "Classify marginal notes by x-position separation from body text", "sidecar/main.py", SIDECAR_VERSION),
];

export function getRuleById(ruleId: string): EngineRule | undefined {
  return RULE_REGISTRY.find((r) => r.ruleId === ruleId);
}

export function isStatutoryRuleId(ruleId: string): boolean {
  const rule = getRuleById(ruleId);
  return rule?.kind === "statutory";
}
