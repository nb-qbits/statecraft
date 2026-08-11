import type { AdjustedDateResult, ComputedDeadline } from "./types.js";
import { addDays, isBusinessDay, nextBusinessDay } from "./holidays.js";

const PACK_VERSION = "1.0.0";

/**
 * § 1-210(E): If a date (specified or computed) falls on a non-business day,
 * roll forward to the next business day.
 */
export function adjustForNonBusinessDay(
  date: string,
  holidaySet: Set<string>,
): AdjustedDateResult {
  const adjusted = nextBusinessDay(date, holidaySet);
  const wasAdjusted = adjusted !== date;

  const ruleIds: string[] = [];
  const citations: string[] = [];

  if (wasAdjusted) {
    ruleIds.push("va-1-210-E");
    citations.push("Va. Code § 1-210(E)");
  }

  return {
    statutoryDate: date,
    adjustedDate: adjusted,
    wasAdjusted,
    ruleIds,
    citations,
    packVersion: PACK_VERSION,
  };
}

/**
 * § 1-210(A): Exclude the day of the triggering event.
 * Then count forward the prescribed number of days.
 *
 * § 1-210(E): If the resulting date falls on a non-business day,
 * roll forward to the next business day.
 */
export function computeDeadline(
  triggerDate: string,
  calendarDays: number,
  dayKind: "calendar" | "business" | "working",
  holidaySet: Set<string>,
): ComputedDeadline {
  const ruleIds: string[] = ["va-1-210-A"];
  const citations: string[] = ["Va. Code § 1-210(A)"];

  let targetDate: string;

  if (dayKind === "calendar") {
    targetDate = addDays(triggerDate, calendarDays);
  } else {
    targetDate = countBusinessDays(triggerDate, calendarDays, holidaySet);
  }

  const adjusted = nextBusinessDay(targetDate, holidaySet);
  const wasAdjusted = adjusted !== targetDate;

  if (wasAdjusted) {
    ruleIds.push("va-1-210-E");
    citations.push("Va. Code § 1-210(E)");
  }

  return {
    statutoryDate: targetDate,
    adjustedDate: adjusted,
    wasAdjusted,
    ruleIds,
    citations,
    packVersion: PACK_VERSION,
  };
}

function countBusinessDays(
  startDate: string,
  count: number,
  holidaySet: Set<string>,
): string {
  let current = startDate;
  let remaining = count;

  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current, holidaySet)) {
      remaining--;
    }
  }

  return current;
}
