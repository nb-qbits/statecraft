import { describe, it, expect } from "vitest";
import { runHarness, computeVariance, computeConfigHash } from "./runner.js";
import type { GoldSet, ProposalSnapshot, RunConfig, HarnessRun } from "./types.js";
import type { ProposalId, AnchorId, SegmentId, DocumentVersionId, Lane, SupportLevel } from "../shared/types.js";

const TEST_CONFIG: RunConfig = {
  scannerVersion: "1.0.0",
  extractorVersion: "1.0.0",
  anchorerVersion: "1.0.0",
  grammarVersion: "1.0.0",
  resolverVersion: "1.0.0",
  evaluatorVersion: "1.0.0",
  routerVersion: "1.0.0",
  reviewVersion: "1.0.0",
  configHash: "test-hash",
  modelId: null,
  promptHash: null,
  goldSchemaVersion: "1.0.0",
  packVersion: "1.0.0",
};

const TEST_GOLD_SET: GoldSet = {
  schemaVersion: "1.0.0",
  createdAt: "2026-08-11T00:00:00Z",
  items: [
    {
      goldItemId: "g1",
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
    },
  ],
};

function makeProposal(quotedText: string): ProposalSnapshot {
  return {
    proposalId: "p1" as ProposalId,
    documentVersionId: "dv-1" as DocumentVersionId,
    anchorId: "anc-1" as AnchorId,
    segmentId: "seg-1" as SegmentId,
    quotedText,
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
  };
}

describe("runHarness", () => {
  it("runs against a gold set and produces a HarnessRun", async () => {
    const run = await runHarness({
      loadGoldSet: async () => TEST_GOLD_SET,
      loadProposals: async () => [makeProposal("July 1, 2025")],
      loadAdjudicationCache: async () => [],
      getRunConfig: () => TEST_CONFIG,
    });

    expect(run.runId).toBeTruthy();
    expect(run.config).toEqual(TEST_CONFIG);
    expect(run.metrics.totalGoldItems).toBe(1);
    expect(run.metrics.totalProposals).toBe(1);
    expect(run.metrics.scorer.precision).toBe(1.0);
    expect(run.metrics.scorer.recall).toBe(1.0);
    expect(run.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run.metrics.errors).toHaveLength(0);
    expect(run.timestamp).toBeTruthy();
  });

  it("records errors when proposal loading fails", async () => {
    const run = await runHarness({
      loadGoldSet: async () => TEST_GOLD_SET,
      loadProposals: async () => { throw new Error("fixture not found"); },
      loadAdjudicationCache: async () => [],
      getRunConfig: () => TEST_CONFIG,
    });

    expect(run.metrics.errors).toHaveLength(1);
    expect(run.metrics.errors[0]).toContain("fixture not found");
    expect(run.metrics.totalProposals).toBe(0);
  });

  it("includes Wilson intervals", async () => {
    const run = await runHarness({
      loadGoldSet: async () => TEST_GOLD_SET,
      loadProposals: async () => [makeProposal("July 1, 2025")],
      loadAdjudicationCache: async () => [],
      getRunConfig: () => TEST_CONFIG,
    });

    expect(run.metrics.precisionInterval.point).toBe(1.0);
    expect(run.metrics.precisionInterval.n).toBe(1);
    expect(run.metrics.recallInterval.point).toBe(1.0);
    expect(run.metrics.recallInterval.n).toBe(1);
  });
});

describe("computeVariance", () => {
  it("reports zero variance for identical runs", () => {
    const baseRun: HarnessRun = {
      runId: "r1",
      config: TEST_CONFIG,
      metrics: {
        totalGoldItems: 1,
        totalProposals: 1,
        scorer: {
          aggregate: { matchedCorrect: 1, matchedWrongValue: 0, missed: 0, falsePositive: 0, split: 0, merged: 0 },
          byLane: [],
          byPatternClass: [],
          fabrication: { totalFabricated: 0, denominator: 0, detected: 0, missed: 0 },
          precision: 1.0,
          recall: 1.0,
          f1: 1.0,
        },
        precisionInterval: { point: 1, lower: 0.5, upper: 1, n: 1 },
        recallInterval: { point: 1, lower: 0.5, upper: 1, n: 1 },
        latencyMs: 10,
        errors: [],
      },
      timestamp: "2026-08-11T00:00:00Z",
    };

    const runs = [
      { ...baseRun, runId: "r1" },
      { ...baseRun, runId: "r2" },
      { ...baseRun, runId: "r3" },
    ];

    const report = computeVariance(runs);
    expect(report.precisionVariance).toBe(0);
    expect(report.recallVariance).toBe(0);
    expect(report.f1Variance).toBe(0);
    expect(report.deterministic).toBe(true);
    expect(report.runs).toHaveLength(3);
  });

  it("reports non-zero variance for different runs", () => {
    const makeRun = (precision: number, recall: number, f1: number, id: string): HarnessRun => ({
      runId: id,
      config: TEST_CONFIG,
      metrics: {
        totalGoldItems: 1,
        totalProposals: 1,
        scorer: {
          aggregate: { matchedCorrect: 1, matchedWrongValue: 0, missed: 0, falsePositive: 0, split: 0, merged: 0 },
          byLane: [],
          byPatternClass: [],
          fabrication: { totalFabricated: 0, denominator: 0, detected: 0, missed: 0 },
          precision,
          recall,
          f1,
        },
        precisionInterval: { point: precision, lower: 0, upper: 1, n: 1 },
        recallInterval: { point: recall, lower: 0, upper: 1, n: 1 },
        latencyMs: 10,
        errors: [],
      },
      timestamp: "2026-08-11T00:00:00Z",
    });

    const runs = [
      makeRun(1.0, 1.0, 1.0, "r1"),
      makeRun(0.5, 0.5, 0.5, "r2"),
    ];

    const report = computeVariance(runs);
    expect(report.precisionVariance).toBeGreaterThan(0);
    expect(report.recallVariance).toBeGreaterThan(0);
    expect(report.f1Variance).toBeGreaterThan(0);
    expect(report.deterministic).toBe(false);
  });

  it("handles single run", () => {
    const run: HarnessRun = {
      runId: "r1",
      config: TEST_CONFIG,
      metrics: {
        totalGoldItems: 1,
        totalProposals: 1,
        scorer: {
          aggregate: { matchedCorrect: 1, matchedWrongValue: 0, missed: 0, falsePositive: 0, split: 0, merged: 0 },
          byLane: [],
          byPatternClass: [],
          fabrication: { totalFabricated: 0, denominator: 0, detected: 0, missed: 0 },
          precision: 1,
          recall: 1,
          f1: 1,
        },
        precisionInterval: { point: 1, lower: 0.5, upper: 1, n: 1 },
        recallInterval: { point: 1, lower: 0.5, upper: 1, n: 1 },
        latencyMs: 10,
        errors: [],
      },
      timestamp: "2026-08-11T00:00:00Z",
    };

    const report = computeVariance([run]);
    expect(report.deterministic).toBe(true);
  });
});

describe("computeConfigHash", () => {
  it("produces deterministic hash", () => {
    const versions = ["1.0.0", "1.0.0", "1.0.0"];
    const h1 = computeConfigHash(versions);
    const h2 = computeConfigHash(versions);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  it("changes when versions change", () => {
    const h1 = computeConfigHash(["1.0.0", "1.0.0"]);
    const h2 = computeConfigHash(["1.0.0", "1.0.1"]);
    expect(h1).not.toBe(h2);
  });
});
