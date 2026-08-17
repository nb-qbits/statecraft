import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import type { JurisdictionPack, PackRules, HolidayCalendar, SessionMetadata, SessionRecord, AdjustedDateResult, ComputedDeadline, EffectiveDateResult } from "./types.js";
import { buildDateSet, addDays, isBusinessDay as isBusinessDayFn, isHoliday as isHolidayFn } from "./holidays.js";
import { deriveEffectiveDate } from "./effective-date.js";
import { adjustForNonBusinessDay, computeDeadline } from "./time-computation.js";

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

  const sessionsPath = resolve(packDir, "sessions.json");
  const sessions: Record<string, SessionRecord> = existsSync(sessionsPath)
    ? JSON.parse(readFileSync(sessionsPath, "utf-8")) as Record<string, SessionRecord>
    : {};

  const qualifiedVersion = `${jurisdiction}/v${packVersion.split(".")[0]}`;

  const pack: JurisdictionPack = {
    jurisdiction,
    packVersion: qualifiedVersion,
    rules,
    holidays,

    getSessionMetadata(session: string): SessionRecord | null {
      return sessions[session] ?? null;
    },

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

export function tryLoadPack(jurisdiction: string, packVersion: string): JurisdictionPack {
  const cacheKey = `${jurisdiction}@${packVersion}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const packDir = resolve(PACKS_ROOT, jurisdiction, `v${packVersion.split(".")[0]}`);
  if (existsSync(packDir)) {
    return loadPack(jurisdiction, packVersion);
  }

  return loadDefaultPack();
}

const GENERIC_CITATION = "Generic convention — not verified for any specific jurisdiction";

function loadDefaultPack(): JurisdictionPack {
  const cacheKey = "default@1";
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const packDir = resolve(PACKS_ROOT, "default", "v1");
  const rules = JSON.parse(readFileSync(resolve(packDir, "rules.json"), "utf-8")) as PackRules;
  const holidays = JSON.parse(readFileSync(resolve(packDir, "holidays.json"), "utf-8")) as HolidayCalendar;
  const holidaySet = buildDateSet(holidays);

  const qualifiedVersion = "default/v1";

  const pack: JurisdictionPack = {
    jurisdiction: "default",
    packVersion: qualifiedVersion,
    rules,
    holidays,

    getSessionMetadata(): SessionRecord | null {
      return null;
    },

    deriveEffectiveDate(): EffectiveDateResult {
      return {
        resolved: false,
        reason: "Default pack cannot derive effective dates — only jurisdiction-specific packs have session-based rules",
        missingInputs: ["jurisdiction_pack"],
      };
    },

    adjustForNonBusinessDay(date: string): AdjustedDateResult {
      return {
        statutoryDate: date,
        adjustedDate: date,
        wasAdjusted: false,
        ruleIds: [],
        citations: [],
        packVersion: qualifiedVersion,
      };
    },

    computeDeadline(
      triggerDate: string,
      calendarDays: number,
      dayKind: "calendar" | "business" | "working",
    ): ComputedDeadline {
      let targetDate: string;
      if (dayKind === "calendar") {
        targetDate = addDays(triggerDate, calendarDays);
      } else {
        let current = triggerDate;
        let remaining = calendarDays;
        while (remaining > 0) {
          current = addDays(current, 1);
          if (isBusinessDayFn(current, holidaySet)) {
            remaining--;
          }
        }
        targetDate = current;
      }
      return {
        statutoryDate: targetDate,
        adjustedDate: targetDate,
        wasAdjusted: false,
        ruleIds: ["generic-day-after-trigger"],
        citations: [GENERIC_CITATION],
        packVersion: qualifiedVersion,
      };
    },

    isHoliday(): boolean {
      return false;
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
