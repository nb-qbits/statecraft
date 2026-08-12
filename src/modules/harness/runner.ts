import { createHash, randomUUID } from "node:crypto";
import type {
  GoldSet,
  ProposalSnapshot,
  AdjudicationEntry,
  RunConfig,
  HarnessRun,
  VarianceReport,
} from "./types.js";
import { matchGoldToProposals } from "./match.js";
import { scoreRun, computeWilsonInterval } from "./scorer.js";

export const HARNESS_VERSION = "1.0.0";

export interface HarnessRunnerDeps {
  loadGoldSet(): Promise<GoldSet>;
  loadProposals(documentFixture: string): Promise<readonly ProposalSnapshot[]>;
  loadAdjudicationCache(): Promise<readonly AdjudicationEntry[]>;
  getRunConfig(): RunConfig;
}

export async function runHarness(deps: HarnessRunnerDeps): Promise<HarnessRun> {
  const startMs = performance.now();
  const config = deps.getRunConfig();
  const goldSet = await deps.loadGoldSet();
  const adjudicationCache = await deps.loadAdjudicationCache();

  const fixtures = [...new Set(goldSet.items.map((g) => g.documentFixture))];
  const allProposals: ProposalSnapshot[] = [];
  const errors: string[] = [];

  for (const fixture of fixtures) {
    try {
      const proposals = await deps.loadProposals(fixture);
      allProposals.push(...proposals);
    } catch (err) {
      errors.push(`Failed to load proposals for ${fixture}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const matchResult = matchGoldToProposals(goldSet.items, allProposals, adjudicationCache);
  const scorer = scoreRun(goldSet.items, allProposals, matchResult);

  const latencyMs = performance.now() - startMs;

  const precisionInterval = computeWilsonInterval(
    scorer.aggregate.matchedCorrect,
    scorer.aggregate.matchedCorrect + scorer.aggregate.falsePositive,
  );
  const recallInterval = computeWilsonInterval(
    scorer.aggregate.matchedCorrect,
    scorer.aggregate.matchedCorrect + scorer.aggregate.missed,
  );

  return {
    runId: randomUUID(),
    config,
    metrics: {
      totalGoldItems: goldSet.items.length,
      totalProposals: allProposals.length,
      scorer,
      precisionInterval,
      recallInterval,
      latencyMs,
      errors,
    },
    timestamp: new Date().toISOString(),
  };
}

export function computeVariance(runs: readonly HarnessRun[]): VarianceReport {
  if (runs.length < 2) {
    return {
      runs,
      precisionVariance: 0,
      recallVariance: 0,
      f1Variance: 0,
      deterministic: true,
    };
  }

  const precisions = runs.map((r) => r.metrics.scorer.precision);
  const recalls = runs.map((r) => r.metrics.scorer.recall);
  const f1s = runs.map((r) => r.metrics.scorer.f1);

  const precisionVariance = variance(precisions);
  const recallVariance = variance(recalls);
  const f1Variance = variance(f1s);

  const deterministic = precisionVariance === 0 && recallVariance === 0 && f1Variance === 0;

  return {
    runs,
    precisionVariance,
    recallVariance,
    f1Variance,
    deterministic,
  };
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0);
  return sumSqDiff / (values.length - 1);
}

export function computeConfigHash(versions: string[]): string {
  return createHash("sha256").update(versions.join(":")).digest("hex");
}
