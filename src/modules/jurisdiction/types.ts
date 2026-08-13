export const HolidayType = {
  legal_holiday: "legal_holiday",
  office_closure: "office_closure",
} as const;
export type HolidayType = (typeof HolidayType)[keyof typeof HolidayType];

export interface HolidayEntry {
  readonly date: string;
  readonly name: string;
  readonly type: HolidayType;
  readonly source: string;
  readonly enabled: boolean;
}

export interface HolidayCalendar {
  readonly [year: string]: readonly HolidayEntry[];
}

export interface EffectiveDateRule {
  readonly ruleId: string;
  readonly citation: string;
  readonly description: string;
  readonly sessionType: string;
  readonly branch: string;
  readonly actType?: string;
}

export interface TimeComputationRule {
  readonly ruleId: string;
  readonly citation: string;
  readonly description: string;
}

export interface PackRules {
  readonly jurisdiction: string;
  readonly packVersion: string;
  readonly effectiveDateRules: readonly EffectiveDateRule[];
  readonly timeComputationRules: readonly TimeComputationRule[];
}

export const SessionType = {
  regular: "regular",
  special: "special",
} as const;
export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export const ActType = {
  general_appropriation: "general_appropriation",
  emergency: "emergency",
  decennial_reapportionment: "decennial_reapportionment",
  ordinary: "ordinary",
} as const;
export type ActType = (typeof ActType)[keyof typeof ActType];

export interface SessionRecord {
  readonly sessionType: SessionType;
  readonly adjournmentDate: string;
  readonly adjournmentKind: "sine_die" | "scheduled";
  readonly source: string;
  readonly retrievedAt: string;
}

export interface SessionMetadata {
  readonly sessionType: SessionType;
  readonly adjournmentDate: string;
  readonly actType: ActType;
  readonly specifiedDate: string | null;
  readonly passageDate: string | null;
}

export interface ResolvedEffectiveDate {
  readonly resolved: true;
  readonly date: string;
  readonly ruleId: string;
  readonly citation: string;
  readonly packVersion: string;
}

export interface UnresolvedEffectiveDate {
  readonly resolved: false;
  readonly reason: string;
  readonly missingInputs: readonly string[];
}

export type EffectiveDateResult = ResolvedEffectiveDate | UnresolvedEffectiveDate;

export interface AdjustedDateResult {
  readonly statutoryDate: string;
  readonly adjustedDate: string;
  readonly wasAdjusted: boolean;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string;
}

export interface ComputedDeadline {
  readonly statutoryDate: string;
  readonly adjustedDate: string;
  readonly wasAdjusted: boolean;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string;
}

export interface JurisdictionPack {
  readonly jurisdiction: string;
  readonly packVersion: string;
  readonly rules: PackRules;
  readonly holidays: HolidayCalendar;
  getSessionMetadata(session: string): SessionRecord | null;
  deriveEffectiveDate(session: SessionMetadata): EffectiveDateResult;
  adjustForNonBusinessDay(date: string): AdjustedDateResult;
  computeDeadline(
    triggerDate: string,
    calendarDays: number,
    dayKind: "calendar" | "business" | "working",
  ): ComputedDeadline;
  isHoliday(date: string): boolean;
  isBusinessDay(date: string): boolean;
}
