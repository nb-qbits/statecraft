import { describe, it, expect, vi } from "vitest";
import type {
  DocumentVersionId,
  DocumentId,
  ContentHash,
  SegmentId,
  AnchorId,
  CandidateId,
  SupportLevel,
  EvaluatorVerdict,
  Fidelity,
} from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { RoutingRepository } from "../../platform/db/routing-repository.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment } from "../parsing/types.js";
import type { SpanEvaluation, DeterministicCheckSummary } from "../evaluation/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { CandidateMatch } from "../scanning/types.js";
import type { DocumentRoutingResult } from "./types.js";
import { createRoutingService } from "./service.js";
import { ROUTER_VERSION } from "./types.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;

function makeVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
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
      number: "35",
      stage: "introduced",
      chapter: null,
    },
    legislativeStatus: "introduced",
    statusProvenance: "default_unknown",
    parseStatus: "parsed",
    scanStatus: "scanned",
    scannerVersion: "1.0.0",
    extractionStatus: "extracted",
    extractorVersion: "1.0.0",
    anchoringStatus: "anchored",
    anchorerVersion: "1.0.0",
    grammarStatus: "parsed_grammar",
    grammarVersion: "1.0.0",
    resolutionStatus: "resolved_resolver",
    resolverVersion: "1.0.0",
    evaluationStatus: "evaluated",
    evaluatorVersion: "1.0.0",
    routingStatus: "unrouted",
    routerVersion: null,
    authoritativeSource: null,
    asOfDate: null,
    retrievedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSegment(id: string, fidelity: Fidelity = "declared"): SourceSegment {
  return {
    segmentId: `seg_${id}` as SegmentId,
    documentVersionId: dvId,
    structuralPath: `/body/p[${id}]`,
    ordinal: parseInt(id),
    rawText: `segment ${id} text`,
    normalizedText: `segment ${id} text`,
    contentHash: `hash_${id}` as ContentHash,
    offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    parserAdapter: "plain-text",
    parserVersion: "1.0.0",
    fidelity,
  };
}

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

function makeEval(anchorId: string, segmentId: string, supportLevel: SupportLevel = "supported"): SpanEvaluation {
  return {
    anchorId: `anc_${anchorId}` as AnchorId,
    segmentId: `seg_${segmentId}` as SegmentId,
    quotedText: "July 1, 2025",
    deterministicResult: makePassingChecks(),
    evaluatorVerdict: supportLevel === "supported" ? ("ambiguous" as EvaluatorVerdict) : (supportLevel as EvaluatorVerdict),
    supportLevel,
  };
}

function makeGrammar(anchorId: string, segmentId: string): SpanParseResult {
  return {
    anchorId: `anc_${anchorId}` as AnchorId,
    segmentId: `seg_${segmentId}` as SegmentId,
    text: "July 1, 2025",
    result: {
      parsed: true,
      expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
    },
  };
}

function makeResolution(anchorId: string, segmentId: string): AnchoredResolution {
  return {
    anchorId: `anc_${anchorId}` as AnchorId,
    segmentId: `seg_${segmentId}` as SegmentId,
    text: "July 1, 2025",
    expression: { kind: "fixed_date", month: 7, day: 1, year: 2025 },
    result: {
      resolved: true,
      statutoryDate: "2025-07-01",
      adjustedDate: "2025-07-01",
      ruleIds: ["FIXED_DATE"],
      citations: [],
      packVersion: "us-va/v1",
      warnings: [],
      inputs: [],
    },
  };
}

function makeCandidate(segmentId: string): CandidateMatch {
  return {
    candidateId: `cand_${segmentId}` as CandidateId,
    segmentId: `seg_${segmentId}` as SegmentId,
    kind: "date",
    ruleId: "date.explicit",
    matchedText: "July 1, 2025",
    matchStart: 0,
    matchEnd: 13,
    suppressed: false,
  };
}

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
} as unknown as Logger;

function createStubs() {
  return {
    ingestionRepository: {
      getVersion: vi.fn(),
      findOrCreateDocument: vi.fn(),
      findVersionByHash: vi.fn(),
      insertVersion: vi.fn(),
      listVersions: vi.fn(),
      getDocument: vi.fn(),
    } as unknown as IngestionRepository,
    parsingRepository: {
      getSegmentsByVersion: vi.fn(async () => [makeSegment("1"), makeSegment("2")]),
    } as unknown as ParsingRepository,
    scanningRepository: {
      getCandidatesByVersion: vi.fn(async () => [makeCandidate("1")]),
    } as unknown as ScanningRepository,
    evaluationRepository: {
      getResultsByVersion: vi.fn(async () => [makeEval("1", "1")]),
    } as unknown as EvaluationRepository,
    grammarRepository: {
      getResultsByVersion: vi.fn(async () => [makeGrammar("1", "1")]),
    } as unknown as GrammarRepository,
    resolverRepository: {
      getResultsByVersion: vi.fn(async () => [makeResolution("1", "1")]),
    } as unknown as ResolverRepository,
    routingRepository: {
      insertResults: vi.fn(),
      getResultsByVersion: vi.fn(async () => null),
      deleteResultsByVersion: vi.fn(),
      updateRoutingStatus: vi.fn(),
      getAssignmentsByLane: vi.fn(async () => []),
      getAssignmentsByVersion: vi.fn(async () => []),
    } as unknown as RoutingRepository,
  };
}

describe("routing service", () => {
  it("routes a document and returns assignments with reasons", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(makeVersion());
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    const result = await service.routeDocument(dvId);

    expect(result.documentVersionId).toBe(dvId);
    expect(result.routerVersion).toBe(ROUTER_VERSION);
    expect(result.totalAssignments).toBe(1);
    expect(result.assignments[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("throws when document not found", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    await expect(service.routeDocument(dvId)).rejects.toThrow("not found");
  });

  it("throws when document not evaluated", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ evaluationStatus: "unevaluated" }),
    );
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    await expect(service.routeDocument(dvId)).rejects.toThrow("not been evaluated");
  });

  it("INV-8: introduced document never routes to straight_through", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ legislativeStatus: "introduced" }),
    );
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    const result = await service.routeDocument(dvId);

    for (const assignment of result.assignments) {
      expect(assignment.lane).not.toBe("straight_through");
    }
  });

  it("coverage counts reconcile: every segment in exactly one state", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(makeVersion());
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    const result = await service.routeDocument(dvId);
    const cov = result.coverage;

    expect(
      cov.withCandidates + cov.screenedNoCandidate + cov.needsSweep,
    ).toBe(cov.totalSegments);

    const segIds = cov.segments.map((s) => s.segmentId);
    expect(new Set(segIds).size).toBe(cov.totalSegments);
  });

  it("persists results and updates routing status", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(makeVersion());
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    await service.routeDocument(dvId);

    expect(stubs.routingRepository.insertResults).toHaveBeenCalledOnce();
    expect(stubs.routingRepository.updateRoutingStatus).toHaveBeenCalledWith(
      dvId, "routed", ROUTER_VERSION,
    );
  });

  it("returns existing results when already routed with current version", async () => {
    const existingResult: DocumentRoutingResult = {
      documentVersionId: dvId,
      routerVersion: ROUTER_VERSION,
      assignments: [],
      coverage: { totalSegments: 0, withCandidates: 0, screenedNoCandidate: 0, needsSweep: 0, segments: [] },
      laneSummary: { straight_through: 0, quick_confirmation: 0, exception_review: 0, blocked: 0 },
      totalAssignments: 0,
    };
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ routingStatus: "routed", routerVersion: ROUTER_VERSION }),
    );
    (stubs.routingRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue(existingResult);
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    const result = await service.routeDocument(dvId);
    expect(result).toEqual(existingResult);
    expect(stubs.routingRepository.insertResults).not.toHaveBeenCalled();
  });

  it("re-routes when router version changes", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeVersion({ routingStatus: "routed", routerVersion: "0.9.0" }),
    );
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    await service.routeDocument(dvId);
    expect(stubs.routingRepository.deleteResultsByVersion).toHaveBeenCalledWith(dvId);
    expect(stubs.routingRepository.insertResults).toHaveBeenCalledOnce();
  });

  it("lane summary counts match assignments", async () => {
    const stubs = createStubs();
    (stubs.ingestionRepository.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(makeVersion());
    (stubs.evaluationRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeEval("1", "1", "supported"),
      makeEval("2", "1", "unsupported"),
    ]);
    (stubs.grammarRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeGrammar("1", "1"),
      makeGrammar("2", "1"),
    ]);
    (stubs.resolverRepository.getResultsByVersion as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeResolution("1", "1"),
      makeResolution("2", "1"),
    ]);
    const service = createRoutingService({ ...stubs, logger: mockLogger });

    const result = await service.routeDocument(dvId);
    const summaryTotal = Object.values(result.laneSummary).reduce((a, b) => a + b, 0);
    expect(summaryTotal).toBe(result.totalAssignments);
  });
});
