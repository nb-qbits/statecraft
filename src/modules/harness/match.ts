import { createHash } from "node:crypto";
import type { ProposalId } from "../shared/types.js";
import type {
  GoldItem,
  ProposalSnapshot,
  MatchPair,
  MatchResult,
  MatchOutcome,
  AdjudicationEntry,
} from "./types.js";

const SPAN_OVERLAP_THRESHOLD = 0.3;
const FIELD_SIMILARITY_THRESHOLD = 0.5;

export function computeProposalContentHash(proposal: ProposalSnapshot): string {
  const content = [
    proposal.segmentId,
    proposal.quotedText,
    proposal.kind,
    proposal.statutoryDate ?? "",
    proposal.adjustedDate ?? "",
    proposal.actor ?? "",
    proposal.deliverable ?? "",
  ].join("|");
  return createHash("sha256").update(content).digest("hex");
}

function computeSpanOverlap(
  goldText: string,
  proposalText: string,
  proposalStart: number,
  proposalEnd: number,
  goldStart?: number,
  goldEnd?: number,
): number {
  const gNorm = goldText.toLowerCase().trim();
  const pNorm = proposalText.toLowerCase().trim();

  if (gNorm.length === 0 || pNorm.length === 0) return 0;

  if (goldStart !== undefined && goldEnd !== undefined && proposalStart >= 0 && proposalEnd > proposalStart) {
    const overlapStart = Math.max(goldStart, proposalStart);
    const overlapEnd = Math.min(goldEnd, proposalEnd);
    if (overlapEnd <= overlapStart) return 0;

    const overlapLen = overlapEnd - overlapStart;
    const unionLen = Math.max(goldEnd, proposalEnd) - Math.min(goldStart, proposalStart);
    return unionLen > 0 ? overlapLen / unionLen : 0;
  }

  if (pNorm.includes(gNorm)) return gNorm.length / pNorm.length;
  if (gNorm.includes(pNorm)) return pNorm.length / gNorm.length;

  const shorter = gNorm.length <= pNorm.length ? gNorm : pNorm;
  const longer = gNorm.length <= pNorm.length ? pNorm : gNorm;
  let bestOverlap = 0;
  for (let len = shorter.length; len >= 3; len--) {
    for (let start = 0; start <= shorter.length - len; start++) {
      const sub = shorter.substring(start, start + len);
      if (longer.includes(sub)) {
        bestOverlap = Math.max(bestOverlap, len);
        break;
      }
    }
    if (bestOverlap > 0) break;
  }

  const maxLen = Math.max(gNorm.length, pNorm.length);
  return maxLen > 0 ? bestOverlap / maxLen : 0;
}

function computeFieldSimilarity(gold: GoldItem, proposal: ProposalSnapshot): { score: number; wrongFields: string[] } {
  const wrongFields: string[] = [];
  let matchedFields = 0;
  let totalFields = 0;

  if (gold.kind !== "none") {
    totalFields++;
    if (gold.kind === proposal.kind) {
      matchedFields++;
    } else {
      wrongFields.push("kind");
    }
  }

  if (gold.deadlineDate !== null) {
    totalFields++;
    if (gold.deadlineDate === proposal.statutoryDate) {
      matchedFields++;
    } else {
      wrongFields.push("deadlineDate");
    }
  }

  if (gold.actor !== null) {
    totalFields++;
    const gActor = gold.actor.toLowerCase().trim();
    const pActor = (proposal.actor ?? "").toLowerCase().trim();
    if (gActor === pActor || pActor.includes(gActor) || gActor.includes(pActor)) {
      matchedFields++;
    } else {
      wrongFields.push("actor");
    }
  }

  if (gold.deliverable !== null) {
    totalFields++;
    const gDel = gold.deliverable.toLowerCase().trim();
    const pDel = (proposal.deliverable ?? "").toLowerCase().trim();
    if (gDel === pDel || pDel.includes(gDel) || gDel.includes(pDel)) {
      matchedFields++;
    } else {
      wrongFields.push("deliverable");
    }
  }

  const score = totalFields > 0 ? matchedFields / totalFields : 1;
  return { score, wrongFields };
}

function determineOutcome(
  spanOverlap: number,
  fieldSimilarity: number,
  wrongFields: readonly string[],
): MatchOutcome {
  if (spanOverlap >= SPAN_OVERLAP_THRESHOLD && fieldSimilarity >= FIELD_SIMILARITY_THRESHOLD) {
    return wrongFields.length === 0 ? "matched_correct" : "matched_wrong_value";
  }
  return "matched_wrong_value";
}

interface CandidateMatch {
  goldIdx: number;
  proposalIdx: number;
  spanOverlap: number;
  fieldSimilarity: number;
  wrongFields: string[];
  combined: number;
}

export function matchGoldToProposals(
  goldItems: readonly GoldItem[],
  proposals: readonly ProposalSnapshot[],
  adjudicationCache: readonly AdjudicationEntry[],
): MatchResult {
  const cacheMap = new Map<string, boolean>();
  for (const entry of adjudicationCache) {
    const key = `${entry.goldItemId}|${entry.proposalContentHash}`;
    cacheMap.set(key, entry.isMatch);
  }

  const positiveGold = goldItems.filter((g) => !g.isNegative);
  const candidates: CandidateMatch[] = [];

  for (let gi = 0; gi < positiveGold.length; gi++) {
    const gold = positiveGold[gi]!;
    for (let pi = 0; pi < proposals.length; pi++) {
      const proposal = proposals[pi]!;

      const contentHash = computeProposalContentHash(proposal);
      const cacheKey = `${gold.goldItemId}|${contentHash}`;
      const cachedResult = cacheMap.get(cacheKey);

      if (cachedResult === false) continue;

      const spanOverlap = computeSpanOverlap(
        gold.quotedText,
        proposal.quotedText,
        proposal.normalizedStart,
        proposal.normalizedEnd,
      );

      if (spanOverlap < 0.1 && cachedResult !== true) continue;

      const { score: fieldSimilarity, wrongFields } = computeFieldSimilarity(gold, proposal);

      const combined = cachedResult === true
        ? 1.0
        : (spanOverlap * 0.6 + fieldSimilarity * 0.4);

      candidates.push({
        goldIdx: gi,
        proposalIdx: pi,
        spanOverlap,
        fieldSimilarity,
        wrongFields,
        combined,
      });
    }
  }

  candidates.sort((a, b) => b.combined - a.combined);

  const usedGold = new Set<number>();
  const usedProposals = new Set<number>();
  const pairs: MatchPair[] = [];

  const goldToProposals = new Map<number, number[]>();
  const proposalToGolds = new Map<number, number[]>();

  for (const c of candidates) {
    if (usedGold.has(c.goldIdx) || usedProposals.has(c.proposalIdx)) {
      if (!usedGold.has(c.goldIdx)) {
        const existing = goldToProposals.get(c.goldIdx) ?? [];
        existing.push(c.proposalIdx);
        goldToProposals.set(c.goldIdx, existing);
      }
      if (!usedProposals.has(c.proposalIdx)) {
        const existing = proposalToGolds.get(c.proposalIdx) ?? [];
        existing.push(c.goldIdx);
        proposalToGolds.set(c.proposalIdx, existing);
      }
      continue;
    }

    if (c.combined < SPAN_OVERLAP_THRESHOLD && c.spanOverlap < SPAN_OVERLAP_THRESHOLD) continue;

    usedGold.add(c.goldIdx);
    usedProposals.add(c.proposalIdx);

    const outcome = determineOutcome(c.spanOverlap, c.fieldSimilarity, c.wrongFields);
    pairs.push({
      goldItemId: positiveGold[c.goldIdx]!.goldItemId,
      proposalId: proposals[c.proposalIdx]!.proposalId,
      outcome,
      spanOverlap: c.spanOverlap,
      fieldSimilarity: c.fieldSimilarity,
      wrongFields: c.wrongFields,
    });

    goldToProposals.set(c.goldIdx, [c.proposalIdx]);
    proposalToGolds.set(c.proposalIdx, [c.goldIdx]);
  }

  for (const [goldIdx, proposalIdxs] of goldToProposals) {
    if (proposalIdxs.length > 1 && usedGold.has(goldIdx)) {
      const existingPairIdx = pairs.findIndex(
        (p) => p.goldItemId === positiveGold[goldIdx]!.goldItemId,
      );
      if (existingPairIdx >= 0) {
        const existing = pairs[existingPairIdx]!;
        pairs[existingPairIdx] = { ...existing, outcome: "split" as MatchOutcome };
      }
    }
  }

  for (const [proposalIdx, goldIdxs] of proposalToGolds) {
    if (goldIdxs.length > 1 && usedProposals.has(proposalIdx)) {
      const existingPairIdx = pairs.findIndex(
        (p) => p.proposalId === proposals[proposalIdx]!.proposalId,
      );
      if (existingPairIdx >= 0) {
        const existing = pairs[existingPairIdx]!;
        pairs[existingPairIdx] = { ...existing, outcome: "merged" as MatchOutcome };
      }
    }
  }

  const unmatchedGold: string[] = [];
  for (let gi = 0; gi < positiveGold.length; gi++) {
    if (!usedGold.has(gi)) {
      unmatchedGold.push(positiveGold[gi]!.goldItemId);
    }
  }

  const unmatchedProposals: ProposalId[] = [];
  for (let pi = 0; pi < proposals.length; pi++) {
    if (!usedProposals.has(pi)) {
      unmatchedProposals.push(proposals[pi]!.proposalId);
    }
  }

  return { pairs, unmatchedGold, unmatchedProposals };
}
