import { describe, it, expect } from "vitest";
import { matchGoldToProposals, computeProposalContentHash } from "./match.js";
import type { GoldItem, ProposalSnapshot, AdjudicationEntry } from "./types.js";
import type { ProposalId, AnchorId, SegmentId, DocumentVersionId, Lane, SupportLevel } from "../shared/types.js";

function goldItem(overrides: Partial<GoldItem> & Pick<GoldItem, "goldItemId" | "quotedText">): GoldItem {
  return {
    documentFixture: "test.txt",
    segmentId: "seg-1" as SegmentId,
    anchorId: null,
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

function proposal(overrides: Partial<ProposalSnapshot> & Pick<ProposalSnapshot, "proposalId" | "quotedText">): ProposalSnapshot {
  return {
    documentVersionId: "dv-1" as DocumentVersionId,
    anchorId: "anc-1" as AnchorId,
    segmentId: "seg-1" as SegmentId,
    kind: "fixed_date",
    normalizedStart: 0,
    normalizedEnd: 10,
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

describe("matchGoldToProposals", () => {
  it("matches a gold item to a proposal with overlapping spans", () => {
    const gold = [goldItem({ goldItemId: "g1", quotedText: "July 1, 2025" })];
    const props = [proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" })];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.outcome).toBe("matched_correct");
    expect(result.pairs[0]!.goldItemId).toBe("g1");
    expect(result.pairs[0]!.proposalId).toBe("p1");
    expect(result.unmatchedGold).toHaveLength(0);
    expect(result.unmatchedProposals).toHaveLength(0);
  });

  it("reports missed when no proposal matches", () => {
    const gold = [goldItem({ goldItemId: "g1", quotedText: "July 1, 2025" })];
    const props: ProposalSnapshot[] = [];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedGold).toEqual(["g1"]);
  });

  it("reports false positive when no gold matches", () => {
    const gold: GoldItem[] = [];
    const props = [proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" })];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedProposals).toEqual(["p1"]);
  });

  it("handles 1:N — one gold item with multiple overlapping proposals", () => {
    const gold = [goldItem({ goldItemId: "g1", quotedText: "within 30 days after the effective date" })];
    const props = [
      proposal({ proposalId: "p1" as ProposalId, quotedText: "within 30 days after the effective date", kind: "relative_duration" }),
      proposal({ proposalId: "p2" as ProposalId, quotedText: "within 30 days after the effective date of this act", kind: "relative_duration" }),
    ];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs.length).toBeGreaterThanOrEqual(1);
    const matchedProposalIds = result.pairs.map((p) => p.proposalId);
    expect(matchedProposalIds.length).toBe(1);
    expect(result.unmatchedProposals.length).toBe(1);
  });

  it("handles N:1 — multiple gold items pointing to same proposal", () => {
    const gold = [
      goldItem({ goldItemId: "g1", quotedText: "July 1, 2025", kind: "fixed_date" }),
      goldItem({ goldItemId: "g2", quotedText: "July 1, 2025", kind: "fixed_date", deadlineDate: "2025-07-02" }),
    ];
    const props = [
      proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" }),
    ];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs.length).toBe(1);
    expect(result.unmatchedGold.length).toBe(1);
  });

  it("matched_wrong_value when dates differ", () => {
    const gold = [goldItem({
      goldItemId: "g1",
      quotedText: "July 1, 2025",
      deadlineDate: "2025-07-01",
    })];
    const props = [proposal({
      proposalId: "p1" as ProposalId,
      quotedText: "July 1, 2025",
      statutoryDate: "2025-07-02",
    })];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.outcome).toBe("matched_wrong_value");
    expect(result.pairs[0]!.wrongFields).toContain("deadlineDate");
  });

  it("skips negative gold items in matching", () => {
    const gold = [goldItem({
      goldItemId: "g-neg",
      quotedText: "",
      isNegative: true,
      patternClass: "negative",
      deadlineDate: null,
    })];
    const props = [proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" })];

    const result = matchGoldToProposals(gold, props, []);
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedGold).toHaveLength(0);
    expect(result.unmatchedProposals).toEqual(["p1"]);
  });

  it("uses adjudication cache — cached match forces pairing", () => {
    const gold = [goldItem({ goldItemId: "g1", quotedText: "something completely different" })];
    const props = [proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" })];

    const contentHash = computeProposalContentHash(props[0]!);
    const cache: AdjudicationEntry[] = [{
      goldItemId: "g1",
      proposalContentHash: contentHash,
      isMatch: true,
      adjudicatorId: "human-1",
      adjudicatedAt: "2026-08-11T00:00:00Z",
    }];

    const result = matchGoldToProposals(gold, props, cache);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.goldItemId).toBe("g1");
  });

  it("uses adjudication cache — cached non-match prevents pairing", () => {
    const gold = [goldItem({ goldItemId: "g1", quotedText: "July 1, 2025" })];
    const props = [proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" })];

    const contentHash = computeProposalContentHash(props[0]!);
    const cache: AdjudicationEntry[] = [{
      goldItemId: "g1",
      proposalContentHash: contentHash,
      isMatch: false,
      adjudicatorId: "human-1",
      adjudicatedAt: "2026-08-11T00:00:00Z",
    }];

    const result = matchGoldToProposals(gold, props, cache);
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedGold).toEqual(["g1"]);
    expect(result.unmatchedProposals).toEqual(["p1"]);
  });

  it("proposalContentHash is deterministic", () => {
    const p = proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" });
    const hash1 = computeProposalContentHash(p);
    const hash2 = computeProposalContentHash(p);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("proposalContentHash changes when content changes", () => {
    const p1 = proposal({ proposalId: "p1" as ProposalId, quotedText: "July 1, 2025" });
    const p2 = proposal({ proposalId: "p1" as ProposalId, quotedText: "July 2, 2025" });
    expect(computeProposalContentHash(p1)).not.toBe(computeProposalContentHash(p2));
  });
});
