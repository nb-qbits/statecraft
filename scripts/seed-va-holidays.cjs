#!/usr/bin/env node
/**
 * Seeds Virginia holiday calendar from date-holidays library,
 * fixes gaps against Va. Code § 2.2-3300, and writes frozen JSON.
 *
 * Run: node scripts/seed-va-holidays.cjs
 * Output: packs/us-va/v1/holidays.json
 *
 * § 2.2-3300 holidays (13 total):
 *   1. New Year's Day (January 1)
 *   2. Martin Luther King Jr. Day (third Monday in January)
 *   3. George Washington Day (third Monday in February)
 *   4. Memorial Day (last Monday in May)
 *   5. Juneteenth (June 19)
 *   6. Independence Day (July 4)
 *   7. Labor Day (first Monday in September)
 *   8. Columbus Day (second Monday in October)
 *   9. Election Day (Tuesday after first Monday in November) — every year
 *  10. Veterans Day (November 11)
 *  11. Thanksgiving Day (fourth Thursday in November)
 *  12. Day after Thanksgiving (Friday after Thanksgiving)
 *  13. Christmas Day (December 25)
 *
 * § 2.2-3300 observed-day rule:
 *   "When holidays fall on Saturday, the preceding Friday is observed;
 *    when on Sunday, the following Monday is observed."
 *
 * The date-holidays library misses:
 *   - Election Day in odd years (library only includes federal election years)
 *   - Friday after Thanksgiving (Day after Thanksgiving)
 *
 * Entry schema:
 *   { date, name, type, source, enabled }
 *   type: "legal_holiday" | "office_closure"
 *   source: "holidays-lib-vacanza" | "va-code-2.2-3300" | "governor-proclamation"
 *   enabled: boolean
 */
const Holidays = require("date-holidays");
const { writeFileSync } = require("fs");
const { resolve } = require("path");

function electionDay(year) {
  const nov1 = new Date(year, 10, 1);
  const dow = nov1.getDay();
  const firstMonday = dow <= 1 ? 1 + (1 - dow) : 1 + (8 - dow);
  const tuesday = firstMonday + 1;
  return `${year}-11-${String(tuesday).padStart(2, "0")}`;
}

function fridayAfterThanksgiving(year) {
  const nov1 = new Date(year, 10, 1);
  const dow = nov1.getDay();
  const firstThursday = dow <= 4 ? 1 + (4 - dow) : 1 + (11 - dow);
  const fourthThursday = firstThursday + 21;
  const friday = fourthThursday + 1;
  return `${year}-11-${String(friday).padStart(2, "0")}`;
}

function observedDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  if (dow === 6) {
    const fri = new Date(d);
    fri.setDate(fri.getDate() - 1);
    return fri.toISOString().slice(0, 10);
  }
  if (dow === 0) {
    const mon = new Date(d);
    mon.setDate(mon.getDate() + 1);
    return mon.toISOString().slice(0, 10);
  }
  return null;
}

const LIB_SOURCE = "holidays-lib-vacanza";
const STATUTE_SOURCE = "va-code-2.2-3300";

const hd = new Holidays("US", "VA");
const result = {};

for (let year = 2024; year <= 2035; year++) {
  const seen = new Set();
  const entries = [];

  const libHolidays = hd.getHolidays(year).filter((h) => h.type === "public");
  for (const h of libHolidays) {
    const date = h.date.split(" ")[0];
    if (h.name.includes("substitute")) continue;
    if (!seen.has(date)) {
      seen.add(date);
      entries.push({
        date,
        name: h.name,
        type: "legal_holiday",
        source: LIB_SOURCE,
        enabled: true,
      });
    }
  }

  const ed = electionDay(year);
  if (!seen.has(ed)) {
    entries.push({
      date: ed,
      name: "Election Day",
      type: "legal_holiday",
      source: STATUTE_SOURCE,
      enabled: true,
    });
    seen.add(ed);
  }

  const fat = fridayAfterThanksgiving(year);
  if (!seen.has(fat)) {
    entries.push({
      date: fat,
      name: "Day after Thanksgiving",
      type: "legal_holiday",
      source: STATUTE_SOURCE,
      enabled: true,
    });
    seen.add(fat);
  }

  const toAdd = [];
  for (const e of entries) {
    const obs = observedDate(e.date);
    if (obs && !seen.has(obs)) {
      toAdd.push({
        date: obs,
        name: `${e.name} (observed)`,
        type: "legal_holiday",
        source: STATUTE_SOURCE,
        enabled: true,
      });
      seen.add(obs);
    }
  }
  entries.push(...toAdd);

  entries.sort((a, b) => a.date.localeCompare(b.date));
  result[year] = entries;
}

const outPath = resolve(__dirname, "../packs/us-va/v1/holidays.json");
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(
  `Years: ${Object.keys(result).join(", ")}, total entries: ${Object.values(result).reduce((s, a) => s + a.length, 0)}`,
);
