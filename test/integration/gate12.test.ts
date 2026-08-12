/**
 * Gate 12 integration tests — Evaluation Harness.
 *
 * These tests exercise the harness in-process against synthetic gold data
 * and live proposal snapshots from the running server.
 *
 * Requires Docker stack running: docker compose up -d --build
 * Then: docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
 *       docker compose exec minio mc mb local/policyaction --ignore-existing
 *       docker compose exec app node dist/platform/db/migrate.js
 *
 * Run: npm run test:integration
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { matchGoldToProposals, computeProposalContentHash } from "../../src/modules/harness/match.js";
import { scoreRun, computeWilsonInterval } from "../../src/modules/harness/scorer.js";
import { runHarness, computeVariance } from "../../src/modules/harness/runner.js";
import type {
  GoldSet,
  GoldItem,
  ProposalSnapshot,
  AdjudicationEntry,
  RunConfig,
} from "../../src/modules/harness/types.js";
import type {
  ProposalId,
  AnchorId,
  SegmentId,
  DocumentVersionId,
  Lane,
  SupportLevel,
} from "../../src/modules/shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIMPLE_BILL_TXT = readFileSync(
  resolve(__dirname, "../../fixtures/documents/simple-bill.txt"),
  "utf-8",
);
const SYNTHETIC_GOLD: GoldSet = JSON.parse(
  readFileSync(resolve(__dirname, "../../fixtures/gold/synthetic-gold.json"), "utf-8"),
);

const UPLOAD_URL = "http://localhost:3000/api/v1/documents/upload";
const BASE_URL = "http://localhost:3000/api/v1";

function buildMultipartBody(
  parts: Array<{
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
  }>,
): { body: Buffer; boundary: string } {
  const boundary =
    "----FormBoundary" + Math.random().toString(36).slice(2, 14);
  const chunks: Buffer[] = [];

  for (const part of parts) {
    let header = `--${boundary}\r\n`;
    if (part.filename) {
      header += `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`;
      header += `Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${part.name}"\r\n`;
    }
    header += "\r\n";
    chunks.push(Buffer.from(header));
    chunks.push(
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
    );
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), boundary };
}

const RUN = Math.random().toString(36).slice(2, 8);

async function uploadAndAnalyse(): Promise<{
  documentVersionId: string;
  proposals: ProposalSnapshot[];
}> {
  const parts = [
    {
      name: "file",
      value: SIMPLE_BILL_TXT,
      filename: "simple-bill-gate12.txt",
      contentType: "text/plain",
    },
    {
      name: "legalIdentity",
      value: JSON.stringify({
        jurisdiction: "Virginia",
        session: "2025",
        instrumentType: "HB",
        number: `12001-${RUN}`,
        stage: "introduced",
        chapter: null,
      }),
    },
  ];
  const { body, boundary } = buildMultipartBody(parts);
  const uploadRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  expect(uploadRes.status).toBe(201);
  const uploadBody = (await uploadRes.json()) as { documentVersionId: string };
  const dvId = uploadBody.documentVersionId;

  const analyseRes = await fetch(
    `${BASE_URL}/documents/${dvId}/analyse`,
    {
      method: "POST",
      headers: { "Idempotency-Key": `analyse-gate12-${dvId}-${RUN}` },
    },
  );
  expect(analyseRes.status).toBe(200);

  const proposalsRes = await fetch(
    `${BASE_URL}/documents/${dvId}/proposals`,
  );
  expect(proposalsRes.status).toBe(200);
  const proposalsBody = (await proposalsRes.json()) as {
    proposals: Array<{
      proposalId: string;
      anchorId: string;
      segmentId: string;
      quotedText: string;
      kind: string;
      normalizedStart: number;
      normalizedEnd: number;
      resolved: boolean;
      statutoryDate: string | null;
      adjustedDate: string | null;
      ruleIds: string[];
      citations: string[];
      packVersion: string | null;
      supportLevel: string;
      lane: string;
      status: string;
    }>;
  };

  const proposals: ProposalSnapshot[] = proposalsBody.proposals.map((p) => ({
    proposalId: p.proposalId as ProposalId,
    documentVersionId: dvId as DocumentVersionId,
    anchorId: p.anchorId as AnchorId,
    segmentId: p.segmentId as SegmentId,
    quotedText: p.quotedText,
    kind: p.kind,
    normalizedStart: p.normalizedStart,
    normalizedEnd: p.normalizedEnd,
    resolved: p.resolved,
    statutoryDate: p.statutoryDate,
    adjustedDate: p.adjustedDate,
    ruleIds: p.ruleIds,
    citations: p.citations,
    packVersion: p.packVersion,
    supportLevel: p.supportLevel as SupportLevel,
    lane: p.lane as Lane,
    deliverable: null,
    actor: null,
    conditions: null,
  }));

  return { documentVersionId: dvId, proposals };
}

describe("Gate 12 — Evaluation Harness", () => {
  it("matchedCorrect is reachable: exact-match gold item produces precision and recall 1.0", async () => {
    const { proposals } = await uploadAndAnalyse();
    expect(proposals.length).toBeGreaterThan(0);

    // Pick a resolved proposal so all value fields are populated
    const target = proposals.find((p) => p.resolved && p.statutoryDate) ?? proposals[0]!;

    // Build a gold item that mirrors the proposal exactly
    const exactGold: GoldItem[] = [{
      goldItemId: "g-exact-match",
      documentFixture: "simple-bill.txt",
      segmentId: target.segmentId,
      anchorId: target.anchorId,
      quotedText: target.quotedText,
      kind: target.kind,
      deadlineDate: target.statutoryDate,
      adjustedDate: target.adjustedDate,
      actor: target.actor,
      deliverable: target.deliverable,
      conditions: target.conditions,
      ruleIds: [...target.ruleIds],
      citations: [...target.citations],
      packVersion: target.packVersion,
      patternClass: "fixed_date",
      expectedLane: target.lane,
      isFabricated: false,
      isNegative: false,
      notes: "Exact mirror of system proposal — proves matchedCorrect path",
    }];

    const result = matchGoldToProposals(exactGold, [target], []);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.outcome).toBe("matched_correct");
    expect(result.pairs[0]!.wrongFields).toHaveLength(0);
    expect(result.unmatchedGold).toHaveLength(0);
    expect(result.unmatchedProposals).toHaveLength(0);

    const score = scoreRun(exactGold, [target], result);
    expect(score.aggregate.matchedCorrect).toBe(1);
    expect(score.precision).toBe(1.0);
    expect(score.recall).toBe(1.0);
    expect(score.f1).toBe(1.0);

    console.log("\n=== EXACT-MATCH PROOF ===");
    console.log("Gold kind:", exactGold[0]!.kind);
    console.log("Proposal kind:", target.kind);
    console.log("Gold deadlineDate:", exactGold[0]!.deadlineDate);
    console.log("Proposal statutoryDate:", target.statutoryDate);
    console.log("Outcome:", result.pairs[0]!.outcome);
    console.log("Precision:", score.precision, "Recall:", score.recall);
    console.log("=== END EXACT-MATCH PROOF ===\n");
  });

  it("scorer runs deterministically against synthetic gold", async () => {
    const { proposals } = await uploadAndAnalyse();

    const result1 = matchGoldToProposals(SYNTHETIC_GOLD.items, proposals, []);
    const score1 = scoreRun(SYNTHETIC_GOLD.items, proposals, result1);

    const result2 = matchGoldToProposals(SYNTHETIC_GOLD.items, proposals, []);
    const score2 = scoreRun(SYNTHETIC_GOLD.items, proposals, result2);

    expect(score1.precision).toBe(score2.precision);
    expect(score1.recall).toBe(score2.recall);
    expect(score1.f1).toBe(score2.f1);
    expect(score1.aggregate).toEqual(score2.aggregate);
    expect(score1.fabrication).toEqual(score2.fabrication);

    expect(score1.byPatternClass.length).toBeGreaterThan(0);
  });

  it("match function handles 1:N and N:1", async () => {
    const { proposals } = await uploadAndAnalyse();

    const oneToManyGold: GoldItem[] = [
      {
        goldItemId: "g-1to-many",
        documentFixture: "simple-bill.txt",
        segmentId: proposals[0]!.segmentId,
        anchorId: null,
        quotedText: proposals[0]!.quotedText,
        kind: proposals[0]!.kind,
        deadlineDate: proposals[0]!.statutoryDate,
        adjustedDate: proposals[0]!.adjustedDate,
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
    ];

    const result1toN = matchGoldToProposals(oneToManyGold, proposals, []);
    expect(result1toN.pairs.length).toBeLessThanOrEqual(proposals.length);
    expect(result1toN.pairs.length).toBeGreaterThanOrEqual(1);

    if (proposals.length >= 2) {
      const manyToOneGold: GoldItem[] = [
        {
          ...oneToManyGold[0]!,
          goldItemId: "g-n-to-1-a",
        },
        {
          ...oneToManyGold[0]!,
          goldItemId: "g-n-to-1-b",
          deadlineDate: "2099-01-01",
        },
      ];

      const resultNto1 = matchGoldToProposals(manyToOneGold, proposals, []);
      expect(resultNto1.pairs.length + resultNto1.unmatchedGold.length).toBe(2);
    }
  });

  it("cached adjudications are reused", async () => {
    const { proposals } = await uploadAndAnalyse();

    const gold: GoldItem[] = [{
      goldItemId: "g-cache-test",
      documentFixture: "simple-bill.txt",
      segmentId: "seg-irrelevant" as SegmentId,
      anchorId: null,
      quotedText: "completely unrelated text that should not match anything",
      kind: "fixed_date",
      deadlineDate: "2099-01-01",
      adjustedDate: "2099-01-01",
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
    }];

    const resultWithout = matchGoldToProposals(gold, proposals, []);
    expect(resultWithout.unmatchedGold).toContain("g-cache-test");

    if (proposals.length > 0) {
      const contentHash = computeProposalContentHash(proposals[0]!);
      const cache: AdjudicationEntry[] = [{
        goldItemId: "g-cache-test",
        proposalContentHash: contentHash,
        isMatch: true,
        adjudicatorId: "human-tester",
        adjudicatedAt: "2026-08-11T00:00:00Z",
      }];

      const resultWith = matchGoldToProposals(gold, proposals, cache);
      expect(resultWith.pairs.length).toBe(1);
      expect(resultWith.pairs[0]!.goldItemId).toBe("g-cache-test");
    }
  });

  it("same configuration 3x reports variance", async () => {
    const { proposals } = await uploadAndAnalyse();

    const config: RunConfig = {
      scannerVersion: "1.0.0",
      extractorVersion: "1.0.0",
      anchorerVersion: "1.0.0",
      grammarVersion: "1.0.0",
      resolverVersion: "1.0.0",
      evaluatorVersion: "1.0.0",
      routerVersion: "1.0.0",
      reviewVersion: "1.0.0",
      configHash: "gate12-test",
      modelId: null,
      promptHash: null,
      goldSchemaVersion: SYNTHETIC_GOLD.schemaVersion,
      packVersion: "1.0.0",
    };

    const deps = {
      loadGoldSet: async () => SYNTHETIC_GOLD,
      loadProposals: async () => proposals,
      loadAdjudicationCache: async (): Promise<AdjudicationEntry[]> => [],
      getRunConfig: () => config,
    };

    const run1 = await runHarness(deps);
    const run2 = await runHarness(deps);
    const run3 = await runHarness(deps);

    const variance = computeVariance([run1, run2, run3]);
    expect(variance.runs).toHaveLength(3);
    expect(variance.precisionVariance).toBe(0);
    expect(variance.recallVariance).toBe(0);
    expect(variance.f1Variance).toBe(0);
    expect(variance.deterministic).toBe(true);
  });

  it("fabricated dates are counted separately and never averaged into aggregate accuracy", async () => {
    const { proposals } = await uploadAndAnalyse();

    const result = matchGoldToProposals(SYNTHETIC_GOLD.items, proposals, []);
    const score = scoreRun(SYNTHETIC_GOLD.items, proposals, result);

    const fabricatedItems = SYNTHETIC_GOLD.items.filter((g) => g.isFabricated);
    expect(fabricatedItems.length).toBeGreaterThan(0);

    expect(score.fabrication.totalFabricated).toBe(fabricatedItems.length);
    expect(score.fabrication.denominator).toBe(fabricatedItems.length);

    const fabricatedIds = new Set(fabricatedItems.map((g) => g.goldItemId));
    const fabricatedInAggregateMiss = SYNTHETIC_GOLD.items.filter(
      (g) => g.isFabricated && result.unmatchedGold.includes(g.goldItemId),
    );
    for (const _ of fabricatedInAggregateMiss) {
      // fabricated items that are unmatched should NOT appear in aggregate.missed
    }
    const nonFabricatedMisses = result.unmatchedGold.filter(
      (gid) => !fabricatedIds.has(gid),
    );
    expect(score.aggregate.missed).toBe(nonFabricatedMisses.length);

    expect(score.fabrication.missed).toBe(0);
    expect(score.fabrication.detected).toBe(fabricatedItems.length);

    console.log("\n=== HARNESS OUTPUT ===");
    console.log(JSON.stringify({
      totalGoldItems: SYNTHETIC_GOLD.items.length,
      totalProposals: proposals.length,
      aggregate: score.aggregate,
      precision: score.precision,
      recall: score.recall,
      f1: score.f1,
      byPatternClass: score.byPatternClass,
      byLane: score.byLane,
      fabrication: score.fabrication,
      precisionInterval: computeWilsonInterval(
        score.aggregate.matchedCorrect,
        score.aggregate.matchedCorrect + score.aggregate.falsePositive,
      ),
      recallInterval: computeWilsonInterval(
        score.aggregate.matchedCorrect,
        score.aggregate.matchedCorrect + score.aggregate.missed,
      ),
    }, null, 2));
    console.log("=== END HARNESS OUTPUT ===\n");
  });
});
