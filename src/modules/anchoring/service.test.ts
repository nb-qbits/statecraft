import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DocumentVersionId,
  DocumentId,
  ContentHash,
  SegmentId,
  AnchoringStatus,
  ModelCallId,
  PromptHash,
} from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment } from "../parsing/types.js";
import type { ModelCallRecord } from "../extraction/types.js";
import type { ProposalAnchorResult } from "./types.js";
import type { SpanProposalKind } from "../extraction/types.js";
import { createAnchoringService, computeAnchorId, suppressOverExtractedProposals, deduplicateSpans } from "./service.js";
import { normalizeForEvidenceMatchV1 } from "../parsing/normalize.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;
const segId = "seg_00000000000000000000000000000001" as SegmentId;

function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return {
    documentVersionId: dvId,
    documentId: docId,
    contentHash: hash,
    mimeType: "text/plain",
    byteSize: 100,
    legalIdentity: {
      jurisdiction: "us-va",
      session: "2025",
      instrumentType: "HB",
      number: "1234",
      stage: "introduced",
      chapter: null,
    },
    legislativeStatus: "unknown",
    statusProvenance: "default_unknown",
    parseStatus: "parsed",
    scanStatus: "scanned",
    scannerVersion: "1.0.0",
    extractionStatus: "extracted",
    extractorVersion: "1.0.0",
    anchoringStatus: "unanchored",
    anchorerVersion: null,
    grammarStatus: "unparsed_grammar",
    grammarVersion: null,
    resolutionStatus: "unresolved_resolver",
    resolverVersion: null,
    evaluationStatus: "unevaluated",
    evaluatorVersion: null,
    routingStatus: "unrouted",
    routerVersion: null,
    authoritativeSource: null,
    asOfDate: null,
    retrievedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSegment(rawText: string): SourceSegment {
  const { normalized, offsetMap } = normalizeForEvidenceMatchV1(rawText);
  return {
    segmentId: segId,
    documentVersionId: dvId,
    structuralPath: "/body/p[0]",
    ordinal: 0,
    rawText,
    normalizedText: normalized,
    contentHash: "hash" as ContentHash,
    offsetMap,
    parserAdapter: "plain-text",
    parserVersion: "1.4.0",
    fidelity: "none",
  };
}

function makeModelCall(proposals: Array<{ quotedText: string; kind: string }>): ModelCallRecord {
  const content = {
    proposals: proposals.map((p) => ({
      segmentId: segId,
      quotedText: p.quotedText,
      kind: p.kind,
    })),
  };
  return {
    modelCallId: "mcall_test" as ModelCallId,
    documentVersionId: dvId,
    segmentId: segId,
    modelId: "test-model",
    promptHash: "ph_test" as PromptHash,
    requestPayload: "{}",
    responsePayload: JSON.stringify(content),
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 0,
    correlationId: "corr-1",
    repaired: false,
    createdAt: new Date().toISOString(),
  };
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => createMockLogger(),
  } as unknown as Logger;
}

function createStubs() {
  const versions = new Map<string, DocumentVersion>();
  const segments = new Map<string, SourceSegment[]>();
  const calls = new Map<string, ModelCallRecord[]>();
  const anchors = new Map<string, ProposalAnchorResult[]>();

  const ingestionRepository: IngestionRepository = {
    findOrCreateDocument: vi.fn(),
    findVersionByHash: vi.fn(),
    insertVersion: vi.fn(),
    getVersion: vi.fn(async (id: DocumentVersionId) => versions.get(id) ?? null),
    listVersions: vi.fn(),
    getDocument: vi.fn(),
    updateJurisdiction: vi.fn(),
    updateLegalIdentity: vi.fn(),
    listAnalysedVersions: vi.fn().mockResolvedValue([]),
  };

  const parsingRepository: ParsingRepository = {
    insertSegments: vi.fn(),
    getSegmentsByVersion: vi.fn(async (id: DocumentVersionId) => segments.get(id) ?? []),
    deleteSegmentsByVersion: vi.fn(),
    updateParseStatus: vi.fn(),
  };

  const extractionRepository: ExtractionRepository = {
    insertCalls: vi.fn(),
    getCallsByVersion: vi.fn(async (id: DocumentVersionId) => calls.get(id) ?? []),
    deleteCallsByVersion: vi.fn(),
    updateExtractionStatus: vi.fn(),
  };

  const anchoringRepository: AnchoringRepository = {
    insertResults: vi.fn(async (_dvId: DocumentVersionId, results: ProposalAnchorResult[]) => {
      anchors.set(_dvId, [...(anchors.get(_dvId) ?? []), ...results]);
    }),
    getResultsByVersion: vi.fn(async (id: DocumentVersionId) => anchors.get(id) ?? []),
    deleteResultsByVersion: vi.fn(async (id: DocumentVersionId) => {
      anchors.delete(id);
    }),
    updateAnchoringStatus: vi.fn(async (id: DocumentVersionId, status: AnchoringStatus) => {
      const v = versions.get(id);
      if (v) versions.set(id, { ...v, anchoringStatus: status });
    }),
  };

  return {
    versions,
    segments,
    calls,
    anchors,
    ingestionRepository,
    parsingRepository,
    extractionRepository,
    anchoringRepository,
  };
}

describe("anchoring service", () => {
  let stubs: ReturnType<typeof createStubs>;
  let service: ReturnType<typeof createAnchoringService>;

  beforeEach(() => {
    stubs = createStubs();
    service = createAnchoringService({
      ...stubs,
      logger: createMockLogger(),
    });
  });

  it("anchors proposals from extracted document", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("The agency shall act within 30 days of receiving the request."),
    ]);
    stubs.calls.set(dvId, [
      makeModelCall([{ quotedText: "within 30 days", kind: "duration" }]),
    ]);

    const result = await service.anchorDocument(dvId);

    expect(result.totalProposals).toBe(1);
    expect(result.totalAnchored).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(result.proposalResults[0]!.result.anchored).toBe(true);
  });

  it("fails fabricated quotes", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("The agency shall act within one workday of receiving notification."),
    ]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "within five business days of such placement", kind: "duration" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    expect(result.totalProposals).toBe(1);
    expect(result.totalAnchored).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(result.proposalResults[0]!.result.anchored).toBe(false);
  });

  it("idempotent: returns existing when already anchored with same version", async () => {
    stubs.versions.set(
      dvId,
      makeVersion({ anchoringStatus: "anchored", anchorerVersion: "1.5.0", extractorVersion: "1.4.0" }),
    );
    stubs.anchors.set(dvId, [
      {
        anchorId: computeAnchorId(segId, "within 30 days", "duration"),
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
      },
    ]);

    const result = await service.anchorDocument(dvId);

    expect(result.totalProposals).toBe(1);
    expect(stubs.parsingRepository.getSegmentsByVersion).not.toHaveBeenCalled();
  });

  it("throws on document not found", async () => {
    await expect(service.anchorDocument(dvId)).rejects.toThrow("not found");
  });

  it("throws on document not extracted", async () => {
    stubs.versions.set(dvId, makeVersion({ extractionStatus: "unextracted" }));

    await expect(service.anchorDocument(dvId)).rejects.toThrow(
      "not been extracted",
    );
  });

  it("no code path returns a value when anchoring fails", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("Short text."),
    ]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "completely fabricated content that does not exist", kind: "duration" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    for (const pr of result.proposalResults) {
      if (!pr.result.anchored) {
        const failResult = pr.result;
        expect(failResult).not.toHaveProperty("normalizedStart");
        expect(failResult).not.toHaveProperty("normalizedEnd");
        expect(failResult).not.toHaveProperty("originalStart");
        expect(failResult).not.toHaveProperty("originalEnd");
        expect(failResult).not.toHaveProperty("method");
        expect(failResult.reason).toBeTruthy();
      }
    }
  });

  it("persists results and updates anchoring status", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("The agency shall act within 30 days."),
    ]);
    stubs.calls.set(dvId, [
      makeModelCall([{ quotedText: "within 30 days", kind: "duration" }]),
    ]);

    await service.anchorDocument(dvId);

    expect(stubs.anchoringRepository.insertResults).toHaveBeenCalledOnce();
    expect(stubs.anchoringRepository.updateAnchoringStatus).toHaveBeenCalledWith(
      dvId,
      "anchored",
      "1.5.0",
    );
  });

  it("computeAnchorId is deterministic", () => {
    const id1 = computeAnchorId(segId, "within 30 days", "duration");
    const id2 = computeAnchorId(segId, "within 30 days", "duration");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^anc_[0-9a-f]{32}$/);
  });
});

const segId2 = "seg_00000000000000000000000000000002" as SegmentId;

function makeAnchoredResult(
  sid: SegmentId,
  quotedText: string,
  kind: SpanProposalKind,
  originalStart: number,
  originalEnd: number,
): ProposalAnchorResult {
  return {
    anchorId: computeAnchorId(sid, quotedText, kind),
    segmentId: sid,
    quotedText,
    kind,
    result: {
      anchored: true,
      normalizedStart: originalStart,
      normalizedEnd: originalEnd,
      originalStart,
      originalEnd,
      method: "exact" as const,
    },
    actor: null,
    actorQuotedText: null,
    actorAnchored: null,
    dependsOnQuotedText: null,
    dependsOnDescription: null,
    dependsOnAnchored: null,
  };
}

describe("over-extraction suppression", () => {
  it("suppresses a fragment whose offsets are contained within a composite in the same segment", () => {
    const results = [
      makeAnchoredResult(segId, "Within 90 days of the effective date of this chapter", "duration", 30, 82),
      makeAnchoredResult(segId, "the effective date of this chapter", "effective_date", 48, 82),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(1);
    expect(active[0]!.quotedText).toBe("Within 90 days of the effective date of this chapter");
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.proposal.quotedText).toBe("the effective date of this chapter");
    expect(suppressed[0]!.containedBy).toBe("Within 90 days of the effective date of this chapter");
  });

  it("does NOT suppress proposals in different segments", () => {
    const results = [
      makeAnchoredResult(segId, "Within 90 days of the effective date of this chapter", "duration", 30, 82),
      makeAnchoredResult(segId2, "the effective date of this chapter", "effective_date", 48, 82),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it("does NOT suppress proposals with identical offsets", () => {
    const results = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it("does NOT suppress when spans do not overlap positionally", () => {
    const results = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "effective date of this act", "effective_date", 50, 75),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it("does NOT suppress same text at different positions — distinct obligations", () => {
    const results = [
      makeAnchoredResult(segId, "within 30 days", "duration", 28, 42),
      makeAnchoredResult(segId, "within 30 days of each subsequent finding", "duration", 70, 111),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it("chains: if A inside B inside C positionally, both A and B are suppressed", () => {
    const results = [
      makeAnchoredResult(segId, "effective date", "effective_date", 48, 62),
      makeAnchoredResult(segId, "the effective date of this chapter", "effective_date", 44, 78),
      makeAnchoredResult(segId, "Within 90 days of the effective date of this chapter", "duration", 26, 78),
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(1);
    expect(active[0]!.quotedText).toBe("Within 90 days of the effective date of this chapter");
    expect(suppressed).toHaveLength(2);
    const suppressedTexts = suppressed.map((s) => s.proposal.quotedText).sort();
    expect(suppressedTexts).toEqual([
      "effective date",
      "the effective date of this chapter",
    ]);
  });

  it("skips unanchored proposals — they cannot be positionally compared", () => {
    const results: ProposalAnchorResult[] = [
      makeAnchoredResult(segId, "Within 90 days of the effective date of this chapter", "duration", 30, 82),
      {
        anchorId: computeAnchorId(segId, "fabricated text", "duration"),
        segmentId: segId,
        quotedText: "fabricated text",
        kind: "duration",
        result: { anchored: false, reason: "no_match" },
        actor: null,
        actorQuotedText: null,
        actorAnchored: null,
        dependsOnQuotedText: null,
        dependsOnDescription: null,
        dependsOnAnchored: null,
      },
    ];

    const { active, suppressed } = suppressOverExtractedProposals(results);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });

  it("marks suppressed proposals with over_extraction_substring reason in anchorDocument", async () => {
    const stubs = createStubs();
    const service = createAnchoringService({
      ...stubs,
      logger: createMockLogger(),
    });

    const rawText = "The agency shall act within 90 days of the effective date of this chapter.";
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [makeSegment(rawText)]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "within 90 days of the effective date of this chapter", kind: "duration" },
        { quotedText: "the effective date of this chapter", kind: "effective_date" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    const anchored = result.proposalResults.filter((r) => r.result.anchored);
    const suppressed = result.proposalResults.filter(
      (r) => !r.result.anchored && r.result.reason === "over_extraction_substring",
    );

    expect(anchored).toHaveLength(1);
    expect(anchored[0]!.quotedText).toBe("within 90 days of the effective date of this chapter");
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.quotedText).toBe("the effective date of this chapter");
  });

  it("does NOT suppress when same text anchors at different positions in anchorDocument", async () => {
    const stubs = createStubs();
    const service = createAnchoringService({
      ...stubs,
      logger: createMockLogger(),
    });

    const rawText =
      "The agency shall report within 30 days and shall investigate within 30 days of each subsequent finding.";
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [makeSegment(rawText)]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "within 30 days", kind: "duration" },
        { quotedText: "within 30 days of each subsequent finding", kind: "duration" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    const anchored = result.proposalResults.filter((r) => r.result.anchored);
    expect(anchored).toHaveLength(2);
    const suppressed = result.proposalResults.filter(
      (r) => !r.result.anchored && r.result.reason === "over_extraction_substring",
    );
    expect(suppressed).toHaveLength(0);
  });

  it("stores containedBy text on over_extraction_substring results", async () => {
    const stubs = createStubs();
    const service = createAnchoringService({
      ...stubs,
      logger: createMockLogger(),
    });

    const rawText = "The agency shall act within 90 days of the effective date of this chapter.";
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [makeSegment(rawText)]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "within 90 days of the effective date of this chapter", kind: "duration" },
        { quotedText: "the effective date of this chapter", kind: "effective_date" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    const suppressed = result.proposalResults.filter(
      (r) => !r.result.anchored && r.result.reason === "over_extraction_substring",
    );
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.result.anchored).toBe(false);
    if (!suppressed[0]!.result.anchored) {
      expect(suppressed[0]!.result.containedBy).toBe(
        "within 90 days of the effective date of this chapter",
      );
    }
  });
});

describe("duplicate span deduplication", () => {
  it("collapses identical-position spans, keeps the first", () => {
    const results: ProposalAnchorResult[] = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
    ];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(1);
    expect(unique[0]).toBe(results[0]);
    expect(duplicates).toHaveLength(2);
  });

  it("collapses spans with same anchor ID even at different positions", () => {
    const results: ProposalAnchorResult[] = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "within 30 days", "duration", 50, 64),
    ];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("does NOT collapse spans with different text at different positions", () => {
    const results: ProposalAnchorResult[] = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId, "within 60 days", "duration", 50, 64),
    ];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("does NOT collapse spans in different segments even with same offsets", () => {
    const results: ProposalAnchorResult[] = [
      makeAnchoredResult(segId, "within 30 days", "duration", 10, 24),
      makeAnchoredResult(segId2, "within 30 days", "duration", 10, 24),
    ];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("collapses unanchored results with same anchor ID", () => {
    const unanchored: ProposalAnchorResult = {
      anchorId: computeAnchorId(segId, "fabricated text", "duration"),
      segmentId: segId,
      quotedText: "fabricated text",
      kind: "duration",
      result: { anchored: false, reason: "no_match" },
      actor: null,
      actorQuotedText: null,
      actorAnchored: null,
      dependsOnQuotedText: null,
      dependsOnDescription: null,
      dependsOnAnchored: null,
    };
    const results: ProposalAnchorResult[] = [unanchored, unanchored];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("passes through unanchored results with different anchor IDs", () => {
    const unanchored1: ProposalAnchorResult = {
      anchorId: computeAnchorId(segId, "fabricated text", "duration"),
      segmentId: segId,
      quotedText: "fabricated text",
      kind: "duration",
      result: { anchored: false, reason: "no_match" },
      actor: null,
      actorQuotedText: null,
      actorAnchored: null,
      dependsOnQuotedText: null,
      dependsOnDescription: null,
      dependsOnAnchored: null,
    };
    const unanchored2: ProposalAnchorResult = {
      anchorId: computeAnchorId(segId, "other text", "duration"),
      segmentId: segId,
      quotedText: "other text",
      kind: "duration",
      result: { anchored: false, reason: "no_match" },
      actor: null,
      actorQuotedText: null,
      actorAnchored: null,
      dependsOnQuotedText: null,
      dependsOnDescription: null,
      dependsOnAnchored: null,
    };
    const results: ProposalAnchorResult[] = [unanchored1, unanchored2];

    const { unique, duplicates } = deduplicateSpans(results);

    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("marks duplicate spans with duplicate_span reason in anchorDocument", async () => {
    const stubs = createStubs();
    const service = createAnchoringService({
      ...stubs,
      logger: createMockLogger(),
    });

    const rawText = "The agency shall act within 30 days of receiving the request.";
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [makeSegment(rawText)]);
    stubs.calls.set(dvId, [
      makeModelCall([
        { quotedText: "within 30 days", kind: "duration" },
        { quotedText: "within 30 days", kind: "duration" },
        { quotedText: "within 30 days", kind: "duration" },
      ]),
    ]);

    const result = await service.anchorDocument(dvId);

    const anchored = result.proposalResults.filter((r) => r.result.anchored);
    const duplicates = result.proposalResults.filter(
      (r) => !r.result.anchored && r.result.reason === "duplicate_span",
    );

    expect(anchored).toHaveLength(1);
    expect(anchored[0]!.quotedText).toBe("within 30 days");
    expect(duplicates).toHaveLength(2);
  });
});
