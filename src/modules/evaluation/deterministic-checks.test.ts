import { describe, it, expect } from "vitest";
import type {
  AnchorId,
  SegmentId,
  DocumentVersionId,
  ContentHash,
} from "../shared/types.js";
import type { ProposalAnchorResult } from "../anchoring/types.js";
import type { SourceSegment } from "../parsing/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { DeterministicCheckInput } from "./deterministic-checks.js";
import {
  checkQuoteAnchored,
  checkSegmentOwnership,
  checkOffsetsValid,
  checkDateParseMatch,
  runDeterministicChecks,
} from "./deterministic-checks.js";

const dvId = "dv-test-001" as DocumentVersionId;
const ancId = "anc_test001" as AnchorId;
const segId = "seg_test001" as SegmentId;

function makeSegment(
  overrides: Partial<SourceSegment> = {},
): SourceSegment {
  return {
    segmentId: segId,
    documentVersionId: dvId,
    structuralPath: "/body/p[0]",
    ordinal: 0,
    rawText: "within 30 days after the effective date of this act",
    normalizedText: "within 30 days after the effective date of this act",
    contentHash: "hash" as ContentHash,
    offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    parserAdapter: "plain-text",
    parserVersion: "1.3.0",
    fidelity: "none",
    ...overrides,
  };
}

function makeAnchorResult(
  overrides: Partial<ProposalAnchorResult> = {},
): ProposalAnchorResult {
  return {
    anchorId: ancId,
    segmentId: segId,
    quotedText: "within 30 days",
    kind: "duration",
    result: {
      anchored: true,
      normalizedStart: 0,
      normalizedEnd: 14,
      originalStart: 0,
      originalEnd: 14,
      method: "exact",
    },
    actor: null,
    actorQuotedText: null,
    actorAnchored: null,
    dependsOnQuotedText: null,
    dependsOnDescription: null,
    dependsOnAnchored: null,
    ...overrides,
  };
}

function makeGrammarResult(
  overrides: Partial<SpanParseResult> = {},
): SpanParseResult {
  return {
    anchorId: ancId,
    segmentId: segId,
    text: "within 30 days",
    result: {
      parsed: true,
      expression: {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: "calendar",
        preposition: "within",
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
    },
    ...overrides,
  };
}

function makeResolution(
  overrides: Partial<AnchoredResolution> = {},
): AnchoredResolution {
  return {
    anchorId: ancId,
    segmentId: segId,
    text: "within 30 days",
    expression: {
      kind: "relative_duration",
      quantity: 30,
      unit: "days",
      dayKind: "calendar",
      preposition: "within",
      referenceEvent: null,
      referenceEventText: null,
      boundKind: "within",
    },
    result: {
      resolved: false,
      refusalKind: "missing_trigger",
      reason: "triggerDate is required to resolve a relative duration",
      missingInputs: ["triggerDate"],
      warnings: [],
      inputs: [],
    },
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<DeterministicCheckInput> = {},
): DeterministicCheckInput {
  return {
    anchorId: ancId,
    segmentId: segId,
    documentVersionId: dvId,
    anchorResult: makeAnchorResult(),
    segment: makeSegment(),
    grammarResult: makeGrammarResult(),
    resolutionResult: makeResolution(),
    ...overrides,
  };
}

describe("Deterministic checks", () => {
  describe("checkQuoteAnchored", () => {
    it("passes when anchor result is anchored", () => {
      const result = checkQuoteAnchored(makeInput());
      expect(result.status).toBe("passed");
    });

    it("fails when no anchor result exists", () => {
      const result = checkQuoteAnchored(
        makeInput({ anchorResult: undefined }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("no anchor result");
    });

    it("fails when anchor result is not anchored (fabricated quote)", () => {
      const result = checkQuoteAnchored(
        makeInput({
          anchorResult: makeAnchorResult({
            result: { anchored: false, reason: "no_match" },
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("no_match");
    });
  });

  describe("checkSegmentOwnership", () => {
    it("passes when segment belongs to document version", () => {
      const result = checkSegmentOwnership(makeInput());
      expect(result.status).toBe("passed");
    });

    it("fails when segment not found (cross-document evidence)", () => {
      const result = checkSegmentOwnership(
        makeInput({ segment: undefined }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("not found");
    });

    it("fails when segment belongs to a different document version", () => {
      const result = checkSegmentOwnership(
        makeInput({
          segment: makeSegment({
            documentVersionId: "dv-other-version" as DocumentVersionId,
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("dv-other-version");
    });
  });

  describe("checkOffsetsValid", () => {
    it("passes when offsets are within bounds", () => {
      const result = checkOffsetsValid(makeInput());
      expect(result.status).toBe("passed");
    });

    it("fails when anchor not anchored", () => {
      const result = checkOffsetsValid(
        makeInput({
          anchorResult: makeAnchorResult({
            result: { anchored: false, reason: "no_match" },
          }),
        }),
      );
      expect(result.status).toBe("failed");
    });

    it("fails when end offset exceeds segment text length", () => {
      const result = checkOffsetsValid(
        makeInput({
          anchorResult: makeAnchorResult({
            result: {
              anchored: true,
              normalizedStart: 0,
              normalizedEnd: 999,
              originalStart: 0,
              originalEnd: 999,
              method: "exact",
            },
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("exceeds segment text length");
    });

    it("fails when start >= end", () => {
      const result = checkOffsetsValid(
        makeInput({
          anchorResult: makeAnchorResult({
            result: {
              anchored: true,
              normalizedStart: 10,
              normalizedEnd: 5,
              originalStart: 10,
              originalEnd: 5,
              method: "exact",
            },
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain(">=");
    });
  });

  describe("checkDateParseMatch", () => {
    it("passes when grammar result is parsed and resolution is consistent", () => {
      const result = checkDateParseMatch(makeInput());
      expect(result.status).toBe("passed");
    });

    it("fails when no grammar result exists", () => {
      const result = checkDateParseMatch(
        makeInput({ grammarResult: undefined }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("no grammar parse result");
    });

    it("fails when grammar parse failed", () => {
      const result = checkDateParseMatch(
        makeInput({
          grammarResult: makeGrammarResult({
            result: { parsed: false, reason: "syntax error", position: 0 },
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("grammar parse failed");
    });

    it("detects date mismatch for fixed_date vs resolution (date mismatch)", () => {
      const result = checkDateParseMatch(
        makeInput({
          grammarResult: makeGrammarResult({
            result: {
              parsed: true,
              expression: {
                kind: "fixed_date",
                month: 7,
                day: 1,
                year: 2025,
              },
            },
          }),
          resolutionResult: makeResolution({
            result: {
              resolved: true,
              statutoryDate: "2026-01-01",
              adjustedDate: "2026-01-01",
              ruleIds: ["verbatim-date"],
              citations: ["date stated in instrument"],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          }),
        }),
      );
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("2025-07-01");
      expect(result.reason).toContain("2026-01-01");
    });

    it("passes when fixed_date matches resolution", () => {
      const result = checkDateParseMatch(
        makeInput({
          grammarResult: makeGrammarResult({
            result: {
              parsed: true,
              expression: {
                kind: "fixed_date",
                month: 7,
                day: 1,
                year: 2025,
              },
            },
          }),
          resolutionResult: makeResolution({
            result: {
              resolved: true,
              statutoryDate: "2025-07-01",
              adjustedDate: "2025-07-01",
              ruleIds: ["verbatim-date"],
              citations: ["date stated in instrument"],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          }),
        }),
      );
      expect(result.status).toBe("passed");
    });

    it("passes when no resolution result exists (not yet resolved)", () => {
      const result = checkDateParseMatch(
        makeInput({ resolutionResult: undefined }),
      );
      expect(result.status).toBe("passed");
    });
  });

  describe("runDeterministicChecks", () => {
    it("returns allPassed=true when all checks pass", () => {
      const result = runDeterministicChecks(makeInput());
      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((c) => c.status === "passed")).toBe(true);
    });

    it("returns allPassed=false when any check fails", () => {
      const result = runDeterministicChecks(
        makeInput({ anchorResult: undefined }),
      );
      expect(result.allPassed).toBe(false);
    });

    it("fabricated quote caught without LLM — all 4 checks reported", () => {
      const result = runDeterministicChecks(
        makeInput({
          anchorResult: makeAnchorResult({
            result: { anchored: false, reason: "fuzzy_ceiling_exceeded" },
          }),
        }),
      );
      expect(result.allPassed).toBe(false);
      const quoteCheck = result.checks.find(
        (c) => c.check === "quote_anchored",
      );
      expect(quoteCheck!.status).toBe("failed");
    });

    it("cross-document evidence caught without LLM", () => {
      const result = runDeterministicChecks(
        makeInput({ segment: undefined }),
      );
      expect(result.allPassed).toBe(false);
      const ownershipCheck = result.checks.find(
        (c) => c.check === "segment_ownership",
      );
      expect(ownershipCheck!.status).toBe("failed");
    });

    it("date mismatch caught without LLM", () => {
      const result = runDeterministicChecks(
        makeInput({
          grammarResult: makeGrammarResult({
            result: {
              parsed: true,
              expression: { kind: "fixed_date", month: 1, day: 1, year: 2030 },
            },
          }),
          resolutionResult: makeResolution({
            result: {
              resolved: true,
              statutoryDate: "2025-07-01",
              adjustedDate: "2025-07-01",
              ruleIds: ["verbatim-date"],
              citations: ["date stated in instrument"],
              packVersion: "us-va/v1",
              warnings: [],
              inputs: [],
            },
          }),
        }),
      );
      expect(result.allPassed).toBe(false);
      const dateCheck = result.checks.find(
        (c) => c.check === "date_parse_match",
      );
      expect(dateCheck!.status).toBe("failed");
    });
  });
});
