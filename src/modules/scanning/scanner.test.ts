import { describe, it, expect } from "vitest";
import type { SegmentId } from "../shared/types.js";
import { CoverageState } from "../shared/types.js";
import type { CandidateMatch } from "./types.js";
import {
  scanSegment,
  computeCandidateId,
  deriveCoverageState,
  SCANNER_VERSION,
} from "./scanner.js";

const SEG = "seg_00000000000000000000000000000001" as SegmentId;

describe("computeCandidateId", () => {
  it("produces deterministic IDs", () => {
    const id1 = computeCandidateId(SEG, "date.explicit_month_day_year", 10, 25);
    const id2 = computeCandidateId(SEG, "date.explicit_month_day_year", 10, 25);
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different inputs", () => {
    const id1 = computeCandidateId(SEG, "date.explicit_month_day_year", 10, 25);
    const id2 = computeCandidateId(SEG, "date.explicit_month_day_year", 10, 26);
    expect(id1).not.toBe(id2);
  });

  it("matches expected pattern", () => {
    const id = computeCandidateId(SEG, "modal.shall", 0, 5);
    expect(id).toMatch(/^cand_[0-9a-f]{32}$/);
  });
});

describe("deriveCoverageState", () => {
  it("returns candidates_found when non-suppressed candidates exist", () => {
    const candidates = [
      { suppressed: false },
      { suppressed: true },
    ] as unknown as readonly CandidateMatch[];
    expect(deriveCoverageState(candidates)).toBe(CoverageState.candidates_found);
  });

  it("returns screened_no_candidate when all candidates suppressed", () => {
    const candidates = [
      { suppressed: true },
    ] as unknown as readonly CandidateMatch[];
    expect(deriveCoverageState(candidates)).toBe(CoverageState.screened_no_candidate);
  });

  it("returns screened_no_candidate when no candidates", () => {
    expect(deriveCoverageState([])).toBe(CoverageState.screened_no_candidate);
  });

  it("only returns CoverageState values", () => {
    const validValues = new Set(Object.values(CoverageState));
    const results = [
      deriveCoverageState([]),
      deriveCoverageState([{ suppressed: true }] as unknown as readonly CandidateMatch[]),
      deriveCoverageState([{ suppressed: false }] as unknown as readonly CandidateMatch[]),
    ];
    for (const r of results) {
      expect(validValues.has(r)).toBe(true);
    }
  });
});

describe("scanSegment", () => {
  it("has a scanner version", () => {
    expect(SCANNER_VERSION).toBe("1.0.0");
  });

  it("returns screened_no_candidate for empty text", () => {
    const result = scanSegment(SEG, "");
    expect(result.coverageState).toBe(CoverageState.screened_no_candidate);
    expect(result.candidates).toHaveLength(0);
  });

  it("returns screened_no_candidate for whitespace-only text", () => {
    const result = scanSegment(SEG, "   \t  ");
    expect(result.coverageState).toBe(CoverageState.screened_no_candidate);
    expect(result.candidates).toHaveLength(0);
  });

  describe("date detection", () => {
    it("detects explicit month-day-year dates", () => {
      const result = scanSegment(SEG, "This act shall become effective on July 1, 2025.");
      const dates = result.candidates.filter(c => c.ruleId === "date.explicit_month_day_year");
      expect(dates).toHaveLength(1);
      expect(dates[0]!.matchedText).toBe("July 1, 2025");
      expect(dates[0]!.kind).toBe("date");
    });

    it("detects multiple dates in one segment", () => {
      const result = scanSegment(
        SEG,
        'by striking "November 30, 2031" and inserting "January 31, 2033".',
      );
      const dates = result.candidates.filter(c => c.ruleId === "date.explicit_month_day_year");
      expect(dates).toHaveLength(2);
      expect(dates[0]!.matchedText).toBe("November 30, 2031");
      expect(dates[1]!.matchedText).toBe("January 31, 2033");
    });

    it("detects numeric slash-separated dates", () => {
      const result = scanSegment(SEG, "Filed on 01/15/2025 and effective 07/01/2025.");
      const dates = result.candidates.filter(c => c.ruleId === "date.explicit_mdy_numeric");
      expect(dates).toHaveLength(2);
    });

    it("does not match section citation numbers as dates", () => {
      const result = scanSegment(SEG, "Pursuant to § 2.2-3704 of the Code.");
      const dates = result.candidates.filter(c => c.kind === "date");
      expect(dates).toHaveLength(0);
    });
  });

  describe("duration detection", () => {
    it("detects 'within N days'", () => {
      const result = scanSegment(SEG, "shall respond within 30 days of receiving.");
      const durations = result.candidates.filter(c => c.ruleId === "duration.within_n_unit");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.matchedText).toBe("within 30 days");
    });

    it("detects 'within N working days'", () => {
      const result = scanSegment(SEG, "shall respond within five working days of receiving.");
      const durations = result.candidates.filter(c => c.ruleId === "duration.within_n_unit");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.matchedText).toBe("within five working days");
    });

    it("detects standalone 'N work days'", () => {
      const result = scanSegment(SEG, "may extend the time period by an additional 60 work days.");
      const durations = result.candidates.filter(c => c.ruleId === "duration.n_unit");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.matchedText).toContain("60 work days");
    });

    it("detects 'an additional seven work days'", () => {
      const result = scanSegment(SEG, "may extend the period for an additional seven work days.");
      const durations = result.candidates.filter(c => c.ruleId === "duration.n_unit");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.matchedText).toContain("seven work days");
    });

    it("detects hyphenated duration", () => {
      const result = scanSegment(SEG, "within the five-work-day period.");
      const durations = result.candidates.filter(c => c.ruleId === "duration.hyphenated");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.matchedText).toBe("five-work-day period");
    });
  });

  describe("temporal connector detection", () => {
    it("detects 'effective date of this act'", () => {
      const result = scanSegment(SEG, "within 30 days after the effective date of this act.");
      const connectors = result.candidates.filter(c => c.ruleId === "temporal.effective_date_ref");
      expect(connectors).toHaveLength(1);
      expect(connectors[0]!.matchedText).toContain("effective date");
    });

    it("detects 'upon enactment'", () => {
      const result = scanSegment(SEG, "This section takes effect upon enactment.");
      const connectors = result.candidates.filter(c => c.ruleId === "temporal.enactment_ref");
      expect(connectors).toHaveLength(1);
      expect(connectors[0]!.matchedText).toBe("upon enactment");
    });
  });

  describe("modal verb detection", () => {
    it("detects 'shall'", () => {
      const result = scanSegment(SEG, "Each agency shall submit a report.");
      const modals = result.candidates.filter(c => c.ruleId === "modal.shall");
      expect(modals).toHaveLength(1);
      expect(modals[0]!.matchedText).toBe("shall");
    });

    it("detects 'may'", () => {
      const result = scanSegment(SEG, "The agency may extend the deadline.");
      const modals = result.candidates.filter(c => c.ruleId === "modal.may");
      expect(modals).toHaveLength(1);
    });

    it("detects 'is authorized to'", () => {
      const result = scanSegment(SEG, "The Secretary is authorized to promulgate rules.");
      const modals = result.candidates.filter(c => c.ruleId === "modal.authorized");
      expect(modals).toHaveLength(1);
    });

    it("detects 'shall endeavor'", () => {
      const result = scanSegment(SEG, "The agency shall endeavor to comply.");
      const modals = result.candidates.filter(c => c.ruleId === "modal.shall_endeavor");
      expect(modals).toHaveLength(1);
    });
  });

  describe("citation detection", () => {
    it("detects section symbol citations", () => {
      const result = scanSegment(SEG, "Pursuant to § 2.2-4002 of the Code.");
      const citations = result.candidates.filter(c => c.ruleId === "citation.section_symbol");
      expect(citations).toHaveLength(1);
      expect(citations[0]!.matchedText).toBe("§ 2.2-4002");
    });

    it("detects § 1-210 as citation not date", () => {
      const result = scanSegment(SEG, "§ 1-210 provides that the day of the act shall be excluded.");
      const citations = result.candidates.filter(c => c.ruleId === "citation.section_symbol");
      expect(citations).toHaveLength(1);
      expect(citations[0]!.matchedText).toBe("§ 1-210");
      const dates = result.candidates.filter(c => c.kind === "date");
      expect(dates).toHaveLength(0);
    });

    it("detects section citations with parenthetical subparts", () => {
      const result = scanSegment(SEG, "Section 5503(d)(7) of title 38.");
      const citations = result.candidates.filter(c => c.ruleId === "citation.section_symbol");
      expect(citations).toHaveLength(0);
    });
  });

  describe("enactment clause detection", () => {
    it("detects Virginia enactment clause", () => {
      const result = scanSegment(SEG, "Be it enacted by the General Assembly of Virginia:");
      const clauses = result.candidates.filter(c => c.ruleId === "enactment.clause");
      expect(clauses).toHaveLength(1);
    });

    it("detects federal enactment clause", () => {
      const result = scanSegment(
        SEG,
        "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,",
      );
      const clauses = result.candidates.filter(c => c.ruleId === "enactment.clause");
      expect(clauses).toHaveLength(1);
    });

    it("detects amendment instruction", () => {
      const result = scanSegment(SEG, "§ 2.2-3704 is amended and reenacted as follows:");
      const instructions = result.candidates.filter(c => c.ruleId === "enactment.amendment_instruction");
      expect(instructions).toHaveLength(1);
    });

    it("detects 'is amended by striking'", () => {
      const result = scanSegment(
        SEG,
        'is amended by striking "November 30, 2031" and inserting "January 31, 2033".',
      );
      const instructions = result.candidates.filter(c => c.ruleId === "enactment.amendment_instruction");
      expect(instructions).toHaveLength(1);
    });
  });

  describe("history line suppression", () => {
    it("suppresses all candidates in a history-line segment", () => {
      const result = scanSegment(SEG, "1997, c. 795; 2019, c. 401.");
      expect(result.coverageState).toBe(CoverageState.screened_no_candidate);
      for (const c of result.candidates) {
        expect(c.suppressed).toBe(true);
      }
    });

    it("suppresses multi-entry history lines", () => {
      const result = scanSegment(SEG, "1997, c. 795; 2001, c. 123; 2019, c. 401.");
      expect(result.coverageState).toBe(CoverageState.screened_no_candidate);
    });

    it("does not suppress non-history-line segments with years", () => {
      const result = scanSegment(SEG, "This act takes effect on July 1, 2025.");
      expect(result.coverageState).toBe(CoverageState.candidates_found);
      const dates = result.candidates.filter(c => c.kind === "date" && !c.suppressed);
      expect(dates.length).toBeGreaterThan(0);
    });
  });

  describe("coverage state", () => {
    it("returns candidates_found when non-suppressed candidates exist", () => {
      const result = scanSegment(SEG, "Each agency shall submit a report.");
      expect(result.coverageState).toBe(CoverageState.candidates_found);
    });

    it("returns screened_no_candidate for text with no patterns", () => {
      const result = scanSegment(SEG, "The quick brown fox jumped over the lazy dog.");
      expect(result.coverageState).toBe(CoverageState.screened_no_candidate);
    });

    it("every segment gets exactly one of the two CoverageState values", () => {
      const validValues = new Set(Object.values(CoverageState));
      const texts = [
        "Each agency shall submit a report.",
        "The quick brown fox.",
        "1997, c. 795; 2019, c. 401.",
        "",
        "within 30 days after the effective date of this act.",
      ];
      for (const text of texts) {
        const result = scanSegment(SEG, text);
        expect(validValues.has(result.coverageState)).toBe(true);
      }
    });
  });

  describe("match span correctness", () => {
    it("reports correct start and end offsets", () => {
      const text = "This act shall become effective on July 1, 2025.";
      const result = scanSegment(SEG, text);
      const date = result.candidates.find(c => c.ruleId === "date.explicit_month_day_year");
      expect(date).toBeDefined();
      expect(text.substring(date!.matchStart, date!.matchEnd)).toBe("July 1, 2025");
    });
  });

  describe("multiple candidates per segment", () => {
    it("finds all pattern types in a dense segment", () => {
      const text =
        "Each agency shall, within 30 days after the effective date of this act, " +
        "submit to the Governor a report pursuant to § 2.2-4002. " +
        "This act shall become effective on July 1, 2025.";
      const result = scanSegment(SEG, text);
      const kinds = new Set(result.candidates.map(c => c.kind));
      expect(kinds.has("date")).toBe(true);
      expect(kinds.has("duration")).toBe(true);
      expect(kinds.has("temporal_connector")).toBe(true);
      expect(kinds.has("modal_verb")).toBe(true);
      expect(kinds.has("citation")).toBe(true);
    });
  });
});
