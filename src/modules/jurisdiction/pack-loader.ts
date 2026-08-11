import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import type { JurisdictionPack, PackRules, HolidayCalendar, SessionMetadata, AdjustedDateResult, ComputedDeadline } from "./types.js";
import { buildDateSet } from "./holidays.js";
import { deriveEffectiveDate } from "./effective-date.js";
import { adjustForNonBusinessDay, computeDeadline } from "./time-computation.js";
import { isBusinessDay as isBusinessDayFn, isHoliday as isHolidayFn } from "./holidays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_ROOT = resolve(__dirname, "../../../packs");

const packCache = new Map<string, JurisdictionPack>();

export function loadPack(jurisdiction: string, packVersion: string): JurisdictionPack {
  const cacheKey = `${jurisdiction}@${packVersion}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const packDir = resolve(PACKS_ROOT, jurisdiction, `v${packVersion.split(".")[0]}`);

  if (!existsSync(packDir)) {
    throw new Error(`jurisdiction pack not found: ${jurisdiction}@${packVersion} (looked in ${packDir})`);
  }

  const rulesPath = resolve(packDir, "rules.json");
  const holidaysPath = resolve(packDir, "holidays.json");

  if (!existsSync(rulesPath)) {
    throw new Error(`rules.json not found in ${packDir}`);
  }
  if (!existsSync(holidaysPath)) {
    throw new Error(`holidays.json not found in ${packDir}`);
  }

  const rules = JSON.parse(readFileSync(rulesPath, "utf-8")) as PackRules;
  const holidays = JSON.parse(readFileSync(holidaysPath, "utf-8")) as HolidayCalendar;
  const holidaySet = buildDateSet(holidays);

  const pack: JurisdictionPack = {
    jurisdiction,
    packVersion,
    rules,
    holidays,

    deriveEffectiveDate(session: SessionMetadata) {
      return deriveEffectiveDate(session);
    },

    adjustForNonBusinessDay(date: string): AdjustedDateResult {
      return adjustForNonBusinessDay(date, holidaySet);
    },

    computeDeadline(
      triggerDate: string,
      calendarDays: number,
      dayKind: "calendar" | "business" | "working",
    ): ComputedDeadline {
      return computeDeadline(triggerDate, calendarDays, dayKind, holidaySet);
    },

    isHoliday(date: string): boolean {
      return isHolidayFn(date, holidaySet);
    },

    isBusinessDay(date: string): boolean {
      return isBusinessDayFn(date, holidaySet);
    },
  };

  packCache.set(cacheKey, pack);
  return pack;
}

export function clearPackCache(): void {
  packCache.clear();
}
