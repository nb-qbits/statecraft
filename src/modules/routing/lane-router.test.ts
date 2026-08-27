import { describe, it, expect } from "vitest";
import type { AnchorId, SegmentId, Fidelity, LegislativeStatus, SupportLevel, EvaluatorVerdict } from "../shared/types.js";
import type { SpanEvaluation, DeterministicCheckSummary } from "../evaluation/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import { assignLane, type LaneInput } from "./lane-router.js";

const anchorId = "anc_001" as AnchorId;
const segmentId = "seg_001" as SegmentId;

function makePassingChecks(): DeterministicCheckSummary {
  return {
    allPassed: true,
    checks: [
      { check: "quote_anchored", status: "passed", reason: null },
      { check: "segment_ownership", status: "passed", reason: null },
      { check: "offsets_valid", status: "passed", reason: null },
      { check: "date_parse_match", status: "passed", reason: null },
    ],
  };
}

function makeFailingChecks(): DeterministicCheckSummary {
  return {
    allPassed: false,
    checks: [
      { check: "quote_anchored", status: "failed", reason: "fabricated" },
      { check: "segment_ownership", status: "passed", reason: null },
      { check: "offsets_valid", status: "passed", reason: null },
      { check: "date_parse_match", status: "passed", reason: null },
    ],
  };
}

function makeEval(overrides: Partial<SpanEvaluation> = {}): SpanEvaluation {
  return {
    anchorId,
    segmentId,
    quotedText: "July 1, 2025",
    deterministicResult: makePassingChecks(),
    evaluatorVerdict: "ambiguous" as EvaluatorVerdict,
    supportLevel: "supported" as SupportLevel,
    ...overrides,
  };
}

function makeGrammarFixed(): SpanParseResult {
  return {
    anchorId,
    segmentId,
    text: "July 1, 2025",
    result: {
      parsed: true,
      expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
    },
  };
}

function makeGrammarRelative(): SpanParseResult {
  return {
    anchorId,
    segmentId,
    text: "within 30 days",
    result: {
      parsed: true,
      expression: {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: "calendar",
        preposition: "within",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
    },
  };
}

function makeGrammarRecurrence(): SpanParseResult {
  return {
    anchorId,
    segmentId,
    text: "every two business days",
    result: {
      parsed: true,
      expression: {
        kind: "recurrence",
        frequency: "daily",
        interval: 2,
        byMonth: null,
        byMonthDay: null,
        yearParity: null,
        anchorEvent: null,
        boundKind: "on",
        dayKind: "business",
      },
    },
  };
}

function makeResolutionResolved(): AnchoredResolution {
  return {
    anchorId,
    segmentId,
    text: "July 1, 2025",
    expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
    result: {
      resolved: true,
      statutoryDate: "2025-07-01",
      adjustedDate: "2025-07-01",
      dateRole: "deadline",
      ruleIds: ["FIXED_DATE"],
      citations: [],
      packVersion: "us-va/v1",
      warnings: [],
      inputs: [],
    },
  };
}

function makeResolutionUnresolved(): AnchoredResolution {
  return {
    anchorId,
    segmentId,
    text: "within 30 days",
    expression: { kind: "relative_duration", quantity: 30, unit: "days", dayKind: "calendar", preposition: "within", referenceEvent: "effective_date", referenceEventText: null, boundKind: "within" as const },
    result: {
      resolved: false,
      refusalKind: "missing_trigger",
      reason: "missing effective_date input",
      ruleIds: ["refusal-missing-trigger"],
      citations: [],
      missingInputs: ["effective_date"],
      warnings: [],
      inputs: [],
    },
  };
}

function makeInput(overrides: Partial<LaneInput> = {}): LaneInput {
  return {
    evaluation: makeEval(),
    grammarResult: makeGrammarFixed(),
    resolutionResult: makeResolutionResolved(),
    segmentFidelity: "declared" as Fidelity,
    legislativeStatus: "enacted" as LegislativeStatus,
    ...overrides,
  };
}

describe("lane-router", () => {
  describe("blocked lane", () => {
    it("unsupported evidence → blocked", () => {
      const result = assignLane(makeInput({
        evaluation: makeEval({ supportLevel: "unsupported" }),
      }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_UNSUPPORTED")).toBe(true);
    });

    it("grammar parse failed → blocked", () => {
      const result = assignLane(makeInput({
        grammarResult: {
          anchorId, segmentId, text: "sometime",
          result: { parsed: false, reason: "unparseable", position: 0 },
        },
      }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_GRAMMAR_FAILED")).toBe(true);
    });

    it("no grammar result → blocked", () => {
      const result = assignLane(makeInput({ grammarResult: undefined }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_GRAMMAR_FAILED")).toBe(true);
    });

    it("unresolved date → blocked", () => {
      const result = assignLane(makeInput({
        resolutionResult: makeResolutionUnresolved(),
      }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_UNRESOLVED")).toBe(true);
    });

    it("no resolution result → blocked", () => {
      const result = assignLane(makeInput({ resolutionResult: undefined }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_UNRESOLVED")).toBe(true);
    });

    it("deterministic checks failed → blocked", () => {
      const result = assignLane(makeInput({
        evaluation: makeEval({ deterministicResult: makeFailingChecks() }),
      }));
      expect(result.lane).toBe("blocked");
      expect(result.reasons.some((r) => r.rule === "BLOCKED_DETERMINISTIC_FAILED")).toBe(true);
    });
  });

  describe("exception_review lane", () => {
    it("ambiguous support level → exception_review", () => {
      const result = assignLane(makeInput({
        evaluation: makeEval({ supportLevel: "ambiguous" }),
      }));
      expect(result.lane).toBe("exception_review");
      expect(result.reasons.some((r) => r.rule === "EXCEPTION_AMBIGUOUS")).toBe(true);
    });

    it("relative duration → exception_review", () => {
      const result = assignLane(makeInput({
        grammarResult: makeGrammarRelative(),
      }));
      expect(result.lane).toBe("exception_review");
      expect(result.reasons.some((r) => r.rule === "EXCEPTION_RELATIVE_DATE")).toBe(true);
    });

    it("relative duration without reference event → exception_review with missing trigger reason", () => {
      const grammarNoRef = makeGrammarRelative();
      const withNoRef: SpanParseResult = {
        ...grammarNoRef,
        result: {
          parsed: true,
          expression: {
            ...(grammarNoRef.result as { parsed: true; expression: { kind: "relative_duration"; quantity: number; unit: "days"; dayKind: "calendar"; preposition: string; referenceEvent: "effective_date"; referenceEventText: null; boundKind: "within" } }).expression,
            referenceEvent: null,
          },
        },
      };
      const result = assignLane(makeInput({ grammarResult: withNoRef }));
      expect(result.lane).toBe("exception_review");
      expect(result.reasons.some((r) => r.rule === "EXCEPTION_MISSING_TRIGGER")).toBe(true);
    });

    it("recurrence → exception_review", () => {
      const result = assignLane(makeInput({
        grammarResult: makeGrammarRecurrence(),
      }));
      expect(result.lane).toBe("exception_review");
      expect(result.reasons.some((r) => r.rule === "EXCEPTION_RECURRENCE")).toBe(true);
    });
  });

  describe("straight_through lane", () => {
    it("all criteria met → straight_through", () => {
      const result = assignLane(makeInput());
      expect(result.lane).toBe("straight_through");
      expect(result.reasons.some((r) => r.rule === "ST_FIXED_DATE")).toBe(true);
      expect(result.reasons.some((r) => r.rule === "ST_SUPPORTED")).toBe(true);
      expect(result.reasons.some((r) => r.rule === "ST_FIDELITY_OK")).toBe(true);
      expect(result.reasons.some((r) => r.rule === "ST_STATUS_OK")).toBe(true);
    });

    it("INV-8: non-enacted status blocks straight_through", () => {
      const result = assignLane(makeInput({
        legislativeStatus: "introduced",
      }));
      expect(result.lane).toBe("quick_confirmation");
      expect(result.lane).not.toBe("straight_through");
      expect(result.reasons.some((r) => r.rule === "ST_STATUS_BLOCKED")).toBe(true);
      expect(result.reasons.some((r) => r.detail.includes("INV-8"))).toBe(true);
    });

    it("INV-8: every non-enacted status blocks straight_through", () => {
      const nonEnactedStatuses: LegislativeStatus[] = [
        "introduced", "engrossed", "enrolled", "vetoed", "failed", "unknown",
      ];
      for (const status of nonEnactedStatuses) {
        const result = assignLane(makeInput({ legislativeStatus: status }));
        expect(result.lane).not.toBe("straight_through");
        expect(result.reasons.some((r) => r.rule === "ST_STATUS_BLOCKED")).toBe(true);
      }
    });

    it("inferred fidelity blocks straight_through — PDF consequence", () => {
      const result = assignLane(makeInput({
        segmentFidelity: "inferred",
      }));
      expect(result.lane).toBe("quick_confirmation");
      expect(result.lane).not.toBe("straight_through");
      expect(result.reasons.some((r) => r.rule === "ST_FIDELITY_BLOCKED")).toBe(true);
    });

    it("none fidelity blocks straight_through", () => {
      const result = assignLane(makeInput({
        segmentFidelity: "none",
      }));
      expect(result.lane).not.toBe("straight_through");
    });

    it("both fidelity and status block → quick_confirmation with both reasons", () => {
      const result = assignLane(makeInput({
        segmentFidelity: "inferred",
        legislativeStatus: "introduced",
      }));
      expect(result.lane).toBe("quick_confirmation");
      expect(result.reasons.some((r) => r.rule === "ST_FIDELITY_BLOCKED")).toBe(true);
      expect(result.reasons.some((r) => r.rule === "ST_STATUS_BLOCKED")).toBe(true);
    });
  });

  describe("quick_confirmation lane", () => {
    it("fixed date, supported, resolved, but inferred fidelity → quick_confirmation", () => {
      const result = assignLane(makeInput({
        segmentFidelity: "inferred",
      }));
      expect(result.lane).toBe("quick_confirmation");
      expect(result.reasons.some((r) => r.rule === "QUICK_CONFIRMATION")).toBe(true);
    });
  });

  describe("determinism", () => {
    it("same input → same lane across multiple calls", () => {
      const input = makeInput();
      const results = Array.from({ length: 10 }, () => assignLane(input));
      const lanes = new Set(results.map((r) => r.lane));
      expect(lanes.size).toBe(1);
    });

    it("same input → same reasons across multiple calls", () => {
      const input = makeInput();
      const r1 = assignLane(input);
      const r2 = assignLane(input);
      expect(r1.reasons).toEqual(r2.reasons);
    });
  });

  describe("reasons are always stored", () => {
    it("every assignment has at least one reason", () => {
      const inputs: LaneInput[] = [
        makeInput(),
        makeInput({ evaluation: makeEval({ supportLevel: "unsupported" }) }),
        makeInput({ evaluation: makeEval({ supportLevel: "ambiguous" }) }),
        makeInput({ grammarResult: makeGrammarRelative() }),
        makeInput({ segmentFidelity: "inferred" as Fidelity }),
        makeInput({ legislativeStatus: "introduced" }),
        makeInput({ resolutionResult: undefined }),
      ];
      for (const input of inputs) {
        const result = assignLane(input);
        expect(result.reasons.length).toBeGreaterThan(0);
      }
    });
  });

  describe("INV-9: auto-publish path does not exist", () => {
    it("assignLane returns a lane recommendation — it never publishes, approves, or marks authoritative", () => {
      const result = assignLane(makeInput());
      expect(result.lane).toBe("straight_through");
      // The result is a LaneAssignment with lane + reasons.
      // There is no "publish", "approve", "authorize", or "authoritative" field.
      // There is no function in this module that acts on straight_through to publish.
      expect(Object.keys(result)).toEqual(["anchorId", "segmentId", "lane", "reasons"]);
    });
  });
});
