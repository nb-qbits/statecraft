import type { AnchorId, SegmentId } from "../shared/types.js";

const anchoredSpanBrand = Symbol("AnchoredSpan");

export interface AnchoredSpan {
  readonly [anchoredSpanBrand]: true;
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
}

export function createAnchoredSpan(
  anchorId: AnchorId,
  segmentId: SegmentId,
  text: string,
): AnchoredSpan {
  return { [anchoredSpanBrand]: true, anchorId, segmentId, text } as AnchoredSpan;
}

export const ExpressionKind = {
  fixed_date: "fixed_date",
  relative_duration: "relative_duration",
  recurrence: "recurrence",
} as const;
export type ExpressionKind =
  (typeof ExpressionKind)[keyof typeof ExpressionKind];

export const DayKind = {
  calendar: "calendar",
  business: "business",
  working: "working",
} as const;
export type DayKind = (typeof DayKind)[keyof typeof DayKind];

export const TimeUnit = {
  hours: "hours",
  days: "days",
} as const;
export type TimeUnit = (typeof TimeUnit)[keyof typeof TimeUnit];

export const ReferenceEvent = {
  effective_date: "effective_date",
  enactment: "enactment",
  passage: "passage",
} as const;
export type ReferenceEvent =
  (typeof ReferenceEvent)[keyof typeof ReferenceEvent];

export interface FixedDateExpression {
  readonly kind: "fixed_date";
  readonly month: number;
  readonly day: number;
  readonly year: number;
}

export interface RelativeDurationExpression {
  readonly kind: "relative_duration";
  readonly quantity: number;
  readonly unit: TimeUnit;
  readonly dayKind: DayKind | null;
  readonly preposition: string | null;
  readonly referenceEvent: ReferenceEvent | null;
  readonly boundKind: "within" | "no_longer_than";
}

export interface RecurrenceExpression {
  readonly kind: "recurrence";
  readonly frequency: string;
  readonly quantity: number;
  readonly unit: TimeUnit;
  readonly dayKind: DayKind | null;
}

export type TemporalExpression =
  | FixedDateExpression
  | RelativeDurationExpression
  | RecurrenceExpression;

export type ParseResult =
  | { readonly parsed: true; readonly expression: TemporalExpression }
  | { readonly parsed: false; readonly reason: string; readonly position: number };

export interface SpanParseResult {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
  readonly result: ParseResult;
}
