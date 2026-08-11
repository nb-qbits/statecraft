import type { HolidayCalendar } from "./types.js";

export function buildDateSet(calendar: HolidayCalendar): Set<string> {
  const allDates: string[] = [];
  for (const year of Object.keys(calendar)) {
    for (const entry of calendar[year]!) {
      if (entry.enabled) {
        allDates.push(entry.date);
      }
    }
  }
  return new Set(allDates);
}

export function isHoliday(date: string, holidaySet: Set<string>): boolean {
  return holidaySet.has(date);
}

export function isWeekend(date: string): boolean {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(date: string, holidaySet: Set<string>): boolean {
  return !isWeekend(date) && !isHoliday(date, holidaySet);
}

export function nextBusinessDay(date: string, holidaySet: Set<string>): string {
  let current = date;
  while (!isBusinessDay(current, holidaySet)) {
    current = addDays(current, 1);
  }
  return current;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
