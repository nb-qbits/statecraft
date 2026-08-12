import { describe, it, expect } from "vitest";
import { scoreRun, computeWilsonInterval } from "./scorer.js";
import type { GoldItem, ProposalSnapshot, MatchResult } from "./types.js";
import type { ProposalId, AnchorId, SegmentId, DocumentVersionId, Lane, SupportLevel } from "../shared/types.js";

function goldItem(overrides: Partial<GoldItem> & Pick<GoldItem, "goldItemId">): GoldItem {
  return {
    documentFixture: "test.txt",
    segmentId: "seg-1" as SegmentId,
    anchorId: null,
    quotedText: "July 1, 2025",
    kind: "fixed_date",
    deadlineDate: "2025-07-01",
    adjustedDate: "2025-07-01",
    actor: null,
    deliverable: null,
    conditions: null,
    ruleIds: [],
    citations: [],
    packVersion: null,
    patternClass: "fixed_date",
    expectedLane: null,
    isFabricated: false,
    isNegative: false,
    notes: null,
    ...overrides,
  };
}

function proposalSnap(overrides: Partial<ProposalSnapshot> & Pick<ProposalSnapshot, "proposalId">): ProposalSnapshot {
  return {
    documentVersionId: "dv-1" as DocumentVersionId,
    anchorId: "anc-1" as AnchorId,
    segmentId: "seg-1" as SegmentId,
    quotedText: "July 1, 2025",
    kind: "fixed_date",
    normalizedStart: 0,
    normalizedEnd: 12,
    resolved: true,
    statutoryDate: "2025-07-01",
    adjustedDate: "2025-07-01",
    ruleIds: [],
    citations: [],
    packVersion: null,
    supportLevel: "supported" as SupportLevel,
    lane: "quick_confirmation" as Lane,
    deliverable: null,
    actor: null,
    conditions: null,
    ...overrides,
  };
}

describe("scoreRun", () => {
  it("scores a perfect run", () => {
    const gold = [goldItem({ goldItemId: "g1" })];
    const props = [proposalSnap({ proposalId: "p1" as ProposalId })];
    const matchResult: MatchResult = {
      pairs: [{
        goldItemId: "g1",
        proposalId: "p1" as ProposalId,
        outcome: "matched_correct",
        spanOverlap: 1.0,
        fieldSimilarity: 1.0,
        wrongFields: [],
      }],
      unmatchedGold: [],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);
    expect(result.aggregate.matchedCorrect).toBe(1);
    expect(result.aggregate.missed).toBe(0);
    expect(result.aggregate.falsePositive).toBe(0);
    expect(result.precision).toBe(1.0);
    expect(result.recall).toBe(1.0);
    expect(result.f1).toBe(1.0);
  });

  it("scores a run with a miss", () => {
    const gold = [goldItem({ goldItemId: "g1" }), goldItem({ goldItemId: "g2" })];
    const props = [proposalSnap({ proposalId: "p1" as ProposalId })];
    const matchResult: MatchResult = {
      pairs: [{
        goldItemId: "g1",
        proposalId: "p1" as ProposalId,
        outcome: "matched_correct",
        spanOverlap: 1.0,
        fieldSimilarity: 1.0,
        wrongFields: [],
      }],
      unmatchedGold: ["g2"],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);
    expect(result.aggregate.matchedCorrect).toBe(1);
    expect(result.aggregate.missed).toBe(1);
    expect(result.precision).toBe(1.0);
    expect(result.recall).toBe(0.5);
  });

  it("scores a run with a false positive", () => {
    const gold = [goldItem({ goldItemId: "g1" })];
    const props = [
      proposalSnap({ proposalId: "p1" as ProposalId }),
      proposalSnap({ proposalId: "p2" as ProposalId }),
    ];
    const matchResult: MatchResult = {
      pairs: [{
        goldItemId: "g1",
        proposalId: "p1" as ProposalId,
        outcome: "matched_correct",
        spanOverlap: 1.0,
        fieldSimilarity: 1.0,
        wrongFields: [],
      }],
      unmatchedGold: [],
      unmatchedProposals: ["p2" as ProposalId],
    };

    const result = scoreRun(gold, props, matchResult);
    expect(result.aggregate.matchedCorrect).toBe(1);
    expect(result.aggregate.falsePositive).toBe(1);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(1.0);
  });

  it("decomposes by pattern class", () => {
    const gold = [
      goldItem({ goldItemId: "g1", patternClass: "fixed_date" }),
      goldItem({ goldItemId: "g2", patternClass: "relative_duration" }),
    ];
    const props = [
      proposalSnap({ proposalId: "p1" as ProposalId }),
      proposalSnap({ proposalId: "p2" as ProposalId }),
    ];
    const matchResult: MatchResult = {
      pairs: [
        { goldItemId: "g1", proposalId: "p1" as ProposalId, outcome: "matched_correct", spanOverlap: 1, fieldSimilarity: 1, wrongFields: [] },
        { goldItemId: "g2", proposalId: "p2" as ProposalId, outcome: "matched_wrong_value", spanOverlap: 0.8, fieldSimilarity: 0.5, wrongFields: ["deadlineDate"] },
      ],
      unmatchedGold: [],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);
    const fixedDate = result.byPatternClass.find((p) => p.patternClass === "fixed_date");
    const relDur = result.byPatternClass.find((p) => p.patternClass === "relative_duration");

    expect(fixedDate?.counts.matchedCorrect).toBe(1);
    expect(relDur?.counts.matchedWrongValue).toBe(1);
  });

  it("decomposes by lane", () => {
    const gold = [goldItem({ goldItemId: "g1" })];
    const props = [proposalSnap({
      proposalId: "p1" as ProposalId,
      lane: "blocked" as Lane,
    })];
    const matchResult: MatchResult = {
      pairs: [{ goldItemId: "g1", proposalId: "p1" as ProposalId, outcome: "matched_correct", spanOverlap: 1, fieldSimilarity: 1, wrongFields: [] }],
      unmatchedGold: [],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);
    const blocked = result.byLane.find((l) => l.lane === "blocked");
    expect(blocked?.counts.matchedCorrect).toBe(1);
  });

  it("fabricated dates have own denominator and never average into aggregate accuracy", () => {
    const gold = [
      goldItem({ goldItemId: "g-real", isFabricated: false }),
      goldItem({ goldItemId: "g-fab", isFabricated: true }),
    ];
    const props = [proposalSnap({ proposalId: "p1" as ProposalId })];
    const matchResult: MatchResult = {
      pairs: [{ goldItemId: "g-real", proposalId: "p1" as ProposalId, outcome: "matched_correct", spanOverlap: 1, fieldSimilarity: 1, wrongFields: [] }],
      unmatchedGold: ["g-fab"],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);

    expect(result.fabrication.totalFabricated).toBe(1);
    expect(result.fabrication.denominator).toBe(1);
    expect(result.fabrication.detected).toBe(1);
    expect(result.fabrication.missed).toBe(0);

    expect(result.aggregate.missed).toBe(0);
  });

  it("fabricated date matched by system counts as missed detection", () => {
    const gold = [
      goldItem({ goldItemId: "g-fab", isFabricated: true }),
    ];
    const props = [proposalSnap({ proposalId: "p1" as ProposalId })];
    const matchResult: MatchResult = {
      pairs: [{ goldItemId: "g-fab", proposalId: "p1" as ProposalId, outcome: "matched_correct", spanOverlap: 1, fieldSimilarity: 1, wrongFields: [] }],
      unmatchedGold: [],
      unmatchedProposals: [],
    };

    const result = scoreRun(gold, props, matchResult);
    expect(result.fabrication.missed).toBe(1);
    expect(result.fabrication.detected).toBe(0);
  });

  it("empty inputs produce zero scores", () => {
    const result = scoreRun([], [], {
      pairs: [],
      unmatchedGold: [],
      unmatchedProposals: [],
    });
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1).toBe(0);
    expect(result.aggregate.matchedCorrect).toBe(0);
  });
});

describe("computeWilsonInterval", () => {
  it("returns zero interval for n=0", () => {
    const interval = computeWilsonInterval(0, 0);
    expect(interval.point).toBe(0);
    expect(interval.lower).toBe(0);
    expect(interval.upper).toBe(0);
    expect(interval.n).toBe(0);
  });

  it("returns interval for perfect score", () => {
    const interval = computeWilsonInterval(10, 10);
    expect(interval.point).toBe(1.0);
    expect(interval.lower).toBeGreaterThan(0.5);
    expect(interval.upper).toBeLessThanOrEqual(1.0);
    expect(interval.n).toBe(10);
  });

  it("returns interval for 50% score", () => {
    const interval = computeWilsonInterval(5, 10);
    expect(interval.point).toBe(0.5);
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.upper).toBeLessThan(1);
    expect(interval.lower).toBeLessThan(0.5);
    expect(interval.upper).toBeGreaterThan(0.5);
  });

  it("wider interval for smaller n", () => {
    const small = computeWilsonInterval(1, 2);
    const large = computeWilsonInterval(50, 100);
    expect(small.upper - small.lower).toBeGreaterThan(large.upper - large.lower);
  });
});
