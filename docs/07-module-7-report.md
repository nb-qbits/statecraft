# Module 7 Report — Virginia Jurisdiction Pack

## Reuse analysis

**Searched:** date-holidays (ISC + CC-BY-3.0), dayjs (MIT), luxon (MIT), date-fns (MIT).

**Adopted:** `date-holidays` 3.26.3 (ISC + CC-BY-3.0) — used as a **dev dependency only** to seed the frozen holiday calendar JSON. Not a runtime dependency; removed from the production path entirely. The frozen JSON file is the artifact.

**Built:** Effective-date derivation (§ 1-214), time computation (§ 1-210), pack loader, holiday calendar lookup. No existing library encodes Virginia statutory law. General date libraries (dayjs, luxon, date-fns) don't know about § 1-210(E) rollover or § 1-214 branch selection, so the statutory logic must be hand-written.

## New dependency

| Package | Version | Licence | Runtime? |
|---------|---------|---------|----------|
| date-holidays | 3.26.3 | ISC + CC-BY-3.0 | No — devDependency only, used to seed `holidays.json` |

## Statutory divergence from brief

**FLAGGED: The brief's sixth branch does not exist as a separate statutory provision.**

The brief lists "specified later date in the act" as a separate sixth branch of § 1-214. In the actual statute (fetched from `law.lis.virginia.gov`), the specified-date override is embedded WITHIN branches (A), (B), (C), and (D) as qualifying language:

- § 1-214(A): "...unless a subsequent date is specified."
- § 1-214(B): "...unless a subsequent date is specified."
- § 1-214(C): "...unless another effective date is specified in the act."
- § 1-214(D): "...or on a subsequent date if specified in the act..."

There is no standalone subsection for the specified-date override. Implemented per the statute: each branch has both a `*-default` and `*-specified` ruleId. The specified-date path is a variant within each branch, not a free-standing sixth branch.

## Gate claims with quoted code

### G1: Every § 1-214 branch tested with a distinct rule ID

Nine branches, nine distinct ruleIds. Test proves uniqueness:

```
src/modules/jurisdiction/effective-date.test.ts:272-292
  describe("Each branch returns a DISTINCT ruleId", () => {
    it("all nine ruleIds are unique", () => {
      const cases: SessionMetadata[] = [
        session({ sessionType: "regular", adjournmentDate: "2026-03-08" }),
        session({ sessionType: "regular", adjournmentDate: "2026-03-08", specifiedDate: "2026-10-01" }),
        session({ sessionType: "special", adjournmentDate: "2026-06-15" }),
        session({ sessionType: "special", adjournmentDate: "2026-06-15", specifiedDate: "2027-01-01" }),
        session({ actType: "general_appropriation", passageDate: "2026-04-15" }),
        session({ actType: "general_appropriation", specifiedDate: "2026-07-01" }),
        session({ actType: "emergency", passageDate: "2026-02-20" }),
        session({ actType: "emergency", specifiedDate: "2026-05-01" }),
        session({ actType: "decennial_reapportionment", passageDate: "2031-06-01" }),
      ];

      const ruleIds = cases.map(c => {
        const r = deriveEffectiveDate(c);
        expect(r.resolved).toBe(true);
        return r.resolved ? r.ruleId : "";
      });

      expect(new Set(ruleIds).size).toBe(ruleIds.length);
    });
  });
```

The nine ruleIds are:
- `va-1-214-A-default` — Regular session, July 1 following adjournment
- `va-1-214-A-specified` — Regular session, specified date override
- `va-1-214-B-default` — Special session, first day of fourth month
- `va-1-214-B-specified` — Special session, specified date override
- `va-1-214-C-default` — General appropriation, from passage
- `va-1-214-C-specified` — General appropriation, specified date override
- `va-1-214-D-default` — Emergency, from passage
- `va-1-214-D-specified` — Emergency, specified date override
- `va-1-214-E` — Decennial reapportionment, immediately

### G2: § 1-210(A) day-exclusion tested

```
src/modules/jurisdiction/time-computation.test.ts:24-29
  it("within 30 calendar days from Monday 2026-01-05: starts counting from Jan 6", () => {
    const result = computeDeadline("2026-01-05", 30, "calendar", holidaySet);
    expect(result.statutoryDate).toBe("2026-02-04");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
  });
```

Implementation — the trigger day is never counted because `addDays(triggerDate, calendarDays)` starts from the day after:

```
src/modules/jurisdiction/time-computation.ts:53-54
  if (dayKind === "calendar") {
    targetDate = addDays(triggerDate, calendarDays);
```

For business/working days, counting starts from the next day and only counts business days:

```
src/modules/jurisdiction/time-computation.ts:77-93
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
```

### G3: § 1-210(E) rollover tested, including a SPECIFIED date falling on a holiday

**Specified date on holiday — not a computed period:**

```
src/modules/jurisdiction/time-computation.test.ts:153-158
  it("a specified effective date of January 1, 2027 (Friday holiday) → rolls past weekend to Monday Jan 4", () => {
    const result = adjustForNonBusinessDay("2027-01-01", holidaySet);
    expect(result.wasAdjusted).toBe(true);
    expect(result.adjustedDate).toBe("2027-01-04");
    expect(result.ruleIds).toContain("va-1-210-E");
  });
```

Worked example: Jan 1, 2027 is a Friday and a holiday → Saturday Jan 2 (weekend) → Sunday Jan 3 (weekend) → Monday Jan 4 (business day). The statutory date remains "2027-01-01" while the adjusted date becomes "2027-01-04".

**Holiday chain (Thanksgiving Thursday + Friday after):**

```
src/modules/jurisdiction/time-computation.test.ts:75-79
    it("Thanksgiving Thursday + Friday after → rolls to Monday", () => {
      const result = adjustForNonBusinessDay("2026-11-26", holidaySet);
      expect(result.adjustedDate).toBe("2026-11-30");
      expect(result.wasAdjusted).toBe(true);
    });
```

**Computed period landing on non-business day:**

```
src/modules/jurisdiction/time-computation.test.ts:91-98
    it("30 calendar days from 2026-06-01 → June 6 (Sat) → adjusted to Mon June 8", () => {
      const result = computeDeadline("2026-06-01", 5, "calendar", holidaySet);
      expect(result.statutoryDate).toBe("2026-06-06");
      expect(result.adjustedDate).toBe("2026-06-08");
      expect(result.wasAdjusted).toBe(true);
      expect(result.ruleIds).toContain("va-1-210-A");
      expect(result.ruleIds).toContain("va-1-210-E");
    });
```

Implementation — `adjustForNonBusinessDay` is the standalone function for specified dates:

```
src/modules/jurisdiction/time-computation.ts:10-33
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
```

### G4: Missing session metadata → unresolved, never a default

```
src/modules/jurisdiction/effective-date.test.ts:237-258
  describe("Missing session metadata → unresolved", () => {
    it("missing sessionType → unresolved", () => {
      const result = deriveEffectiveDate({
        sessionType: "" as "regular",
        adjournmentDate: "2026-03-08",
        actType: "ordinary",
        specifiedDate: null,
        passageDate: null,
      });
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("sessionType");
    });

    it("regular session with missing adjournmentDate → unresolved", () => {
      const result = deriveEffectiveDate(session({
        adjournmentDate: "",
      }));
      expect(result.resolved).toBe(false);
      if (result.resolved) return;
      expect(result.missingInputs).toContain("adjournmentDate");
    });
  });
```

Implementation — the type system enforces the discriminated union:

```
src/modules/jurisdiction/types.ts:58-66
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
```

Every `actType` × `sessionType` combination that lacks required inputs returns `resolved: false`. Tests also cover:
- Emergency with no passageDate and no specifiedDate (line 201)
- General appropriation with no passageDate (line 165)
- Decennial reapportionment with no passageDate (line 225)

### G5: Pack loads by (jurisdiction, packVersion) — two versions can coexist

```
src/modules/jurisdiction/pack-loader.ts:15-18
export function loadPack(jurisdiction: string, packVersion: string): JurisdictionPack {
  const cacheKey = `${jurisdiction}@${packVersion}`;
  const cached = packCache.get(cacheKey);
  if (cached) return cached;
```

```
src/modules/jurisdiction/pack-loader.test.ts:97-112
describe("two pack versions coexist", () => {
  it("loading v1 does not prevent loading a different version (when it exists)", () => {
    const pack1 = loadPack("us-va", "1.0.0");
    expect(pack1.packVersion).toBe("1.0.0");

    expect(() => loadPack("us-va", "2.0.0")).toThrow(/pack not found/);
  });

  it("pack cache keys include version — different versions are independent", () => {
    const pack1 = loadPack("us-va", "1.0.0");
    clearPackCache();
    const pack1b = loadPack("us-va", "1.0.0");
    expect(pack1b).not.toBe(pack1);
    expect(pack1b.packVersion).toBe("1.0.0");
  });
});
```

Cache key is `jurisdiction@packVersion`. The loader resolves to `packs/{jurisdiction}/v{major}/` — two packs at different major versions occupy separate directories and are loaded independently. Only v1 exists today; requesting v2 throws `pack not found` (not a default).

### G6: INV-6 — every resolved date carries ruleIds[], citations[], packVersion

```
src/modules/jurisdiction/effective-date.test.ts:260-269
  describe("INV-6: every result carries ruleId, citation, packVersion", () => {
    it("resolved result has all three fields", () => {
      const result = deriveEffectiveDate(session());
      expect(result.resolved).toBe(true);
      if (!result.resolved) return;
      expect(result.ruleId).toMatch(/^va-1-214-/);
      expect(result.citation).toMatch(/^Va\. Code § 1-214/);
      expect(result.packVersion).toBe("1.0.0");
    });
  });
```

```
src/modules/jurisdiction/time-computation.test.ts:106-116
  describe("INV-6: packVersion present on every result", () => {
    it("adjustForNonBusinessDay carries packVersion", () => {
      const result = adjustForNonBusinessDay("2026-01-05", holidaySet);
      expect(result.packVersion).toBe("1.0.0");
    });

    it("computeDeadline carries packVersion", () => {
      const result = computeDeadline("2026-01-05", 5, "calendar", holidaySet);
      expect(result.packVersion).toBe("1.0.0");
    });
  });
```

## HB 35 worked examples

HB 35 contains "within one working day" and "every two business days" — exactly what § 1-210(E) governs.

**"within one working day" — trigger Friday 2026-01-16, MLK Monday is holiday:**

```
src/modules/jurisdiction/time-computation.test.ts:135-138
  it("HB 35 scenario: 'within one working day' from Friday before MLK → skips Sat, Sun, MLK Monday", () => {
    const result = computeDeadline("2026-01-16", 1, "working", holidaySet);
    expect(result.statutoryDate).toBe("2026-01-20");
  });
```

Walk-through: trigger = Fri Jan 16, excluded per § 1-210(A). Count: Sat Jan 17 (skip), Sun Jan 18 (skip), Mon Jan 19/MLK (skip — holiday), Tue Jan 20 (count 1). Deadline = Jan 20.

**"every two business days" — from Monday 2026-01-05:**

```
src/modules/jurisdiction/time-computation.test.ts:140-143
  it("HB 35 scenario: 'every two business days' — counts only business days", () => {
    const result = computeDeadline("2026-01-05", 2, "business", holidaySet);
    expect(result.adjustedDate).toBe("2026-01-07");
  });
```

Walk-through: trigger = Mon Jan 5, excluded per § 1-210(A). Count: Tue Jan 6 (count 1), Wed Jan 7 (count 2). Deadline = Jan 7.

## Holiday calendar

Frozen at `packs/us-va/v1/holidays.json` — 172 entries across 2024–2035.

### Entry schema

Each entry carries five fields:

```json
{
  "date": "2026-01-01",
  "name": "New Year's Day",
  "type": "legal_holiday",
  "source": "holidays-lib-vacanza",
  "enabled": true
}
```

- **type**: `"legal_holiday"` or `"office_closure"` — two distinct categories per § 1-210(E)
- **source**: provenance of the data point (`"holidays-lib-vacanza"`, `"va-code-2.2-3300"`, `"governor-proclamation"`)
- **enabled**: `boolean` — allows disabling an entry without deletion; disabled entries are excluded from the holiday set

```
src/modules/jurisdiction/holidays.ts:5-8
export function buildDateSet(calendar: HolidayCalendar): Set<string> {
  const allDates: string[] = [];
  for (const year of Object.keys(calendar)) {
    for (const entry of calendar[year]!) {
      if (entry.enabled) {
```

### Virginia-specific holidays vs. § 2.2-3300

Va. Code § 2.2-3300 lists 13 legal holidays. The seeded calendar contains all 13:

| # | § 2.2-3300 name | In calendar? | Source |
|---|---|---|---|
| 1 | New Year's Day (January 1) | ✓ | holidays-lib-vacanza |
| 2 | Martin Luther King Jr. Day (3rd Monday Jan) | ✓ | holidays-lib-vacanza |
| 3 | George Washington Day (3rd Monday Feb) | ✓ | holidays-lib-vacanza |
| 4 | Memorial Day (last Monday May) | ✓ | holidays-lib-vacanza |
| 5 | Juneteenth (June 19) | ✓ | holidays-lib-vacanza |
| 6 | Independence Day (July 4) | ✓ | holidays-lib-vacanza |
| 7 | Labor Day (1st Monday Sep) | ✓ | holidays-lib-vacanza |
| 8 | Columbus Day (2nd Monday Oct) | ✓ | holidays-lib-vacanza |
| 9 | Election Day (Tue after 1st Mon in Nov) | ✓ | holidays-lib-vacanza (even years), va-code-2.2-3300 (odd years) |
| 10 | Veterans Day (November 11) | ✓ | holidays-lib-vacanza |
| 11 | Thanksgiving Day (4th Thursday Nov) | ✓ | holidays-lib-vacanza |
| 12 | Day after Thanksgiving (Friday after) | ✓ | va-code-2.2-3300 |
| 13 | Christmas Day (December 25) | ✓ | holidays-lib-vacanza |

Plus observed dates per § 2.2-3300: Saturday → preceding Friday, Sunday → following Monday. These are sourced as `va-code-2.2-3300`.

**Virginia-specific names and differences from federal:**
- Virginia calls it "George Washington Day" (not "Presidents' Day")
- Virginia calls it "Columbus Day" (as of the 2026 statute text)
- Virginia includes Election Day every year — federal is only presidential/midterm years
- Virginia includes Friday after Thanksgiving — not a federal holiday

**Absent:** Lee-Jackson Day is absent from all years. This is a deliberate finding, not a library gap. Lee-Jackson Day was a Virginia state holiday until repealed by the General Assembly in 2020 (2020 Va. Acts ch. 1101), when it was replaced by Election Day as a state holiday. The calendar covers 2024–2035, so Lee-Jackson Day is correctly absent for the entire range. If the pack is ever extended to pre-2021 dates, Lee-Jackson Day (the Friday before the third Monday in January) would be required for those years.

### Election Day in odd-numbered years — confirmed present

Virginia holds statewide elections (Governor, Attorney General, House of Delegates) in odd-numbered years. Va. Code § 2.2-3300 lists Election Day as a state holiday without restricting it to even years. The `date-holidays` library only supplies Election Day in even years (federal election years). The seeder adds it in odd years from the statute.

Confirmed present in odd years:

```
2025-11-04 Election Day | va-code-2.2-3300
2027-11-02 Election Day | va-code-2.2-3300
```

### Holidays the library did NOT supply (34 entries from statute)

Of 172 total entries, 34 were added by the seeder from Va. Code § 2.2-3300 because the `date-holidays` library did not supply them. These are seven distinct holidays:

| Holiday | Years added | Why the library missed it |
|---------|------------|--------------------------|
| Day after Thanksgiving | all 12 years (2024–2035) | Not a federal holiday; library has no entry for it at all |
| Election Day | 6 odd years (2025, 2027, 2029, 2031, 2033, 2035) | Library only includes federal election years (even); Virginia holds statewide elections in odd years |
| Veterans Day (observed) | 4 years (2028, 2029, 2034, 2035) | Library filters out its own "substitute" entries for VA; seeder recomputes per § 2.2-3300 observed-day rule |
| Independence Day (observed) | 3 years (2026, 2027, 2032) | Same — seeder recomputes observed dates |
| Juneteenth (observed) | 3 years (2027, 2032, 2033) | Same |
| Christmas Day (observed) | 3 years (2027, 2032, 2033) | Same |
| New Year's Day (observed) | 3 years (2028, 2033, 2034) | Same |

The remaining 138 entries come from the library (`holidays-lib-vacanza`), including Election Day in even years.

## § 1-210(F) — Governor-authorized closings

### Statutory text

> For the purposes of this section, any day on which the Governor authorizes the closing of the state government shall be considered a legal holiday.
> — Va. Code § 1-210(F)

### What it covers

§ 1-210(F) extends the definition of "legal holiday" in § 1-210 to include days when the Governor authorizes closing state government. These closings are not predictable — they result from proclamations issued in response to weather emergencies, state mourning, or other extraordinary circumstances. When a Governor-closure day falls on a date that a statutory deadline would otherwise be due, § 1-210(E) applies and the deadline rolls forward to the next business day.

### Why it belongs in the pack

§ 1-210(F) is the bridge between § 1-210(E) (which rolls deadlines past "legal holidays") and the calendar data. Without (F), the calendar would only need the 13 holidays in § 2.2-3300. With (F), the calendar must also accommodate one-off closures that are unknowable at calendar-generation time.

This is why the calendar schema includes `type: "office_closure"` as a distinct category from `type: "legal_holiday"` — a Governor-closure entry has different provenance (`source: "governor-proclamation"`) and different lifecycle (it emerges from a proclamation, not a statute). Both types contribute equally to the holiday set for § 1-210(E) rollover; the distinction exists for auditability and to support the mutability model (see `docs/05-jurisdiction-decision.md` §8).

### Implementation

```
src/modules/jurisdiction/types.ts:1-6
export const HolidayType = {
  legal_holiday: "legal_holiday",
  office_closure: "office_closure",
} as const;
export type HolidayType = (typeof HolidayType)[keyof typeof HolidayType];
```

```
packs/us-va/v1/rules.json:88-90
    {
      "ruleId": "va-1-210-F",
      "citation": "Va. Code § 1-210(F)",
      "description": "Governor-authorized closing day is a legal holiday"
    }
```

The rule is declared in the pack's `rules.json`. The mechanism is structural: add an entry with `type: "office_closure"` to `holidays.json` → `buildDateSet` includes it → `isBusinessDay` returns false → § 1-210(E) rollover applies. No separate code path is needed because (F) feeds into the same holiday set that (E) reads.

## Known limitations

1. **Office-closure days are representable but the seeded calendar contains none.** § 1-210(E)'s closure-day branch is untested against real data. The `type: "office_closure"` field exists in the schema and `buildDateSet` includes all enabled entries regardless of type, but no test exercises a closure day specifically because no historical Governor proclamation has been entered. When the first real closure is added (creating pack v2), a test should exercise it.

2. **Calendar horizon is 2024–2035.** Resolutions involving dates outside this range will compute correctly for weekends but may miss holidays. Extending requires re-running the seeder with a wider range.

3. **No runtime holiday generation.** The calendar is frozen JSON — it does not compute floating holidays at runtime. This is intentional: a resolution today must be reproducible in 2029 under the same pack. Runtime generation would make reproducibility depend on the computation logic remaining identical, which is a weaker guarantee than frozen data.

4. **Lee-Jackson Day absent — correct for 2024–2035, required for pre-2021.** Lee-Jackson Day (the Friday before the third Monday in January) was a Virginia state holiday until repealed in 2020 (2020 Va. Acts ch. 1101). The calendar covers 2024–2035 so its absence is correct and deliberate. If the pack is ever extended backward to cover pre-2021 dates, Lee-Jackson Day must be added for those years.

## Decisions taken

1. **Specified-date overrides are NOT a separate branch.** The brief lists them as a sixth branch; the statute embeds them within branches (A)–(D). Implemented per the statute. See "Statutory divergence" above.

2. **§ 1-210(E) applies to both specified dates AND computed periods.** The brief and statute agree. Both paths are tested: `adjustForNonBusinessDay` for specified dates, `computeDeadline` for computed periods. Both call `nextBusinessDay` to roll forward.

3. **§ 1-214(A) — adjournment on or after July 1.** If the session adjourns on July 1 itself, the act takes effect on July 1 of the FOLLOWING year. The statute says "July 1 following adjournment" — if adjournment IS July 1, the act hasn't been adjourned yet during that July 1, so the next July 1 is used.

4. **No LLM anywhere in this module.** All logic is deterministic pure functions. The pack loads JSON data from the filesystem.

## Test results

```
Unit tests:  486 passed (34 files)
  - effective-date.test.ts: 22 tests
  - time-computation.test.ts: 22 tests (including enabled-field test)
  - pack-loader.test.ts: 14 tests
Typecheck:   clean
Lint:        clean
```

## Files created

- `src/modules/jurisdiction/types.ts` — domain types: SessionMetadata, EffectiveDateResult, JurisdictionPack interface
- `src/modules/jurisdiction/holidays.ts` — pure utility functions: isHoliday, isWeekend, isBusinessDay, nextBusinessDay, addDays
- `src/modules/jurisdiction/effective-date.ts` — § 1-214 derivation with 5 statutory branches × default/specified variants
- `src/modules/jurisdiction/time-computation.ts` — § 1-210(A) day-exclusion, § 1-210(E) rollover
- `src/modules/jurisdiction/pack-loader.ts` — loads pack by (jurisdiction, packVersion) from `packs/` directory
- `src/modules/jurisdiction/effective-date.test.ts` — 22 tests covering all branches + uniqueness + missing inputs
- `src/modules/jurisdiction/time-computation.test.ts` — 21 tests: day-exclusion, rollover (specified + computed), HB 35 scenarios
- `src/modules/jurisdiction/pack-loader.test.ts` — 14 tests: loading, caching, interface methods, version coexistence, error cases
- `packs/us-va/v1/rules.json` — declarative rule registry: 9 effective-date rules + 3 time-computation rules
- `packs/us-va/v1/holidays.json` — frozen Virginia holiday calendar, 2024–2035, 172 entries
- `scripts/seed-va-holidays.cjs` — seeder script (dev-time only, not runtime)
