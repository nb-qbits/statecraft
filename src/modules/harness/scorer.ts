import type { Lane } from "../shared/types.js";
import type {
  GoldItem,
  ProposalSnapshot,
  MatchResult,
  ConfusionCounts,
  LaneConfusion,
  PatternClassConfusion,
  FabricationReport,
  ScorerResult,
  PatternClass,
  WilsonInterval,
} from "./types.js";

function emptyConfusion(): ConfusionCounts {
  return {
    matchedCorrect: 0,
    matchedWrongValue: 0,
    missed: 0,
    falsePositive: 0,
    split: 0,
    merged: 0,
  };
}

function addToConfusion(target: ConfusionCounts, field: keyof ConfusionCounts, amount: number): ConfusionCounts {
  return { ...target, [field]: target[field] + amount };
}

function confusionTotal(c: ConfusionCounts): number {
  return c.matchedCorrect + c.matchedWrongValue + c.missed + c.falsePositive + c.split + c.merged;
}

export function computeWilsonInterval(successes: number, n: number, z: number = 1.96): WilsonInterval {
  if (n === 0) {
    return { point: 0, lower: 0, upper: 0, n: 0 };
  }

  const pHat = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;

  const center = (pHat + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((pHat * (1 - pHat) + z2 / (4 * n)) / n)) / denominator;

  return {
    point: pHat,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    n,
  };
}

export function scoreRun(
  goldItems: readonly GoldItem[],
  proposals: readonly ProposalSnapshot[],
  matchResult: MatchResult,
): ScorerResult {
  const aggregate = buildAggregate(goldItems, proposals, matchResult);
  const byLane = buildByLane(goldItems, proposals, matchResult);
  const byPatternClass = buildByPatternClass(goldItems, matchResult);
  const fabrication = buildFabricationReport(goldItems, proposals, matchResult);

  const tp = aggregate.matchedCorrect;
  const fp = aggregate.falsePositive;
  const fn = aggregate.missed;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    aggregate,
    byLane,
    byPatternClass,
    fabrication,
    precision,
    recall,
    f1,
  };
}

function buildAggregate(
  goldItems: readonly GoldItem[],
  _proposals: readonly ProposalSnapshot[],
  matchResult: MatchResult,
): ConfusionCounts {
  let counts = emptyConfusion();

  for (const pair of matchResult.pairs) {
    switch (pair.outcome) {
      case "matched_correct":
        counts = addToConfusion(counts, "matchedCorrect", 1);
        break;
      case "matched_wrong_value":
        counts = addToConfusion(counts, "matchedWrongValue", 1);
        break;
      case "split":
        counts = addToConfusion(counts, "split", 1);
        break;
      case "merged":
        counts = addToConfusion(counts, "merged", 1);
        break;
    }
  }

  const nonFabricatedMissed = matchResult.unmatchedGold.filter((gid) => {
    const gold = goldItems.find((g) => g.goldItemId === gid);
    return gold && !gold.isFabricated;
  });
  counts = addToConfusion(counts, "missed", nonFabricatedMissed.length);

  counts = addToConfusion(counts, "falsePositive", matchResult.unmatchedProposals.length);

  return counts;
}

function buildByLane(
  goldItems: readonly GoldItem[],
  proposals: readonly ProposalSnapshot[],
  matchResult: MatchResult,
): LaneConfusion[] {
  const lanes: Lane[] = ["straight_through", "quick_confirmation", "exception_review", "blocked"];
  const result: LaneConfusion[] = [];

  for (const lane of lanes) {
    let counts = emptyConfusion();

    const laneProposalIds = new Set(
      proposals.filter((p) => p.lane === lane).map((p) => p.proposalId),
    );

    for (const pair of matchResult.pairs) {
      if (pair.proposalId && laneProposalIds.has(pair.proposalId)) {
        switch (pair.outcome) {
          case "matched_correct":
            counts = addToConfusion(counts, "matchedCorrect", 1);
            break;
          case "matched_wrong_value":
            counts = addToConfusion(counts, "matchedWrongValue", 1);
            break;
          case "split":
            counts = addToConfusion(counts, "split", 1);
            break;
          case "merged":
            counts = addToConfusion(counts, "merged", 1);
            break;
        }
      }
    }

    for (const proposalId of matchResult.unmatchedProposals) {
      if (laneProposalIds.has(proposalId)) {
        counts = addToConfusion(counts, "falsePositive", 1);
      }
    }

    for (const goldId of matchResult.unmatchedGold) {
      const gold = goldItems.find((g) => g.goldItemId === goldId);
      if (gold && !gold.isFabricated && gold.expectedLane === lane) {
        counts = addToConfusion(counts, "missed", 1);
      }
    }

    const total = confusionTotal(counts);
    if (total > 0) {
      result.push({ lane, counts, total });
    }
  }

  return result;
}

function buildByPatternClass(
  goldItems: readonly GoldItem[],
  matchResult: MatchResult,
): PatternClassConfusion[] {
  const classes: PatternClass[] = ["fixed_date", "relative_duration", "effective_date_ref", "negative"];
  const result: PatternClassConfusion[] = [];

  for (const patternClass of classes) {
    let counts = emptyConfusion();
    const classGoldIds = new Set(
      goldItems.filter((g) => g.patternClass === patternClass).map((g) => g.goldItemId),
    );

    for (const pair of matchResult.pairs) {
      if (classGoldIds.has(pair.goldItemId)) {
        switch (pair.outcome) {
          case "matched_correct":
            counts = addToConfusion(counts, "matchedCorrect", 1);
            break;
          case "matched_wrong_value":
            counts = addToConfusion(counts, "matchedWrongValue", 1);
            break;
          case "split":
            counts = addToConfusion(counts, "split", 1);
            break;
          case "merged":
            counts = addToConfusion(counts, "merged", 1);
            break;
        }
      }
    }

    for (const goldId of matchResult.unmatchedGold) {
      if (classGoldIds.has(goldId)) {
        const gold = goldItems.find((g) => g.goldItemId === goldId);
        if (gold && !gold.isFabricated) {
          counts = addToConfusion(counts, "missed", 1);
        }
      }
    }

    const total = confusionTotal(counts);
    if (total > 0) {
      result.push({ patternClass, counts, total });
    }
  }

  return result;
}

function buildFabricationReport(
  goldItems: readonly GoldItem[],
  _proposals: readonly ProposalSnapshot[],
  matchResult: MatchResult,
): FabricationReport {
  const fabricatedGold = goldItems.filter((g) => g.isFabricated);
  const totalFabricated = fabricatedGold.length;

  if (totalFabricated === 0) {
    return { totalFabricated: 0, denominator: 0, detected: 0, missed: 0 };
  }

  const fabricatedIds = new Set(fabricatedGold.map((g) => g.goldItemId));

  let producedBySystem = 0;
  for (const pair of matchResult.pairs) {
    if (fabricatedIds.has(pair.goldItemId)) {
      producedBySystem++;
    }
  }

  const detected = totalFabricated - producedBySystem;
  const missed = producedBySystem;

  return {
    totalFabricated,
    denominator: totalFabricated,
    detected,
    missed,
  };
}
