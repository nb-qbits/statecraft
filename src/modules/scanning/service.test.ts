import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentVersionId, DocumentId, ContentHash, SegmentId, CandidateId, ParseStatus, ScanStatus } from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment } from "../parsing/types.js";
import type { CandidateMatch } from "./types.js";
import { createScanningService } from "./service.js";
import { SCANNER_VERSION } from "./scanner.js";

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
      number: "1234",
      stage: "introduced",
      chapter: null,
    },
    legislativeStatus: "unknown",
    statusProvenance: "default_unknown",
    parseStatus: "parsed",
    scanStatus: "unscanned",
    scannerVersion: null,
    extractionStatus: "unextracted",
    extractorVersion: null,
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

function makeSegment(id: string, normalizedText: string): SourceSegment {
  return {
    segmentId: `seg_${id}` as SegmentId,
    documentVersionId: dvId,
    structuralPath: `/body/p[0]`,
    ordinal: 0,
    rawText: normalizedText,
    normalizedText,
    contentHash: "hash" as ContentHash,
    offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    parserAdapter: "plain-text",
    parserVersion: "1.3.0",
    fidelity: "none",
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
  const candidates = new Map<string, CandidateMatch[]>();

  const ingestionRepository: IngestionRepository = {
    findOrCreateDocument: vi.fn(),
    findVersionByHash: vi.fn(),
    insertVersion: vi.fn(),
    getVersion: vi.fn(async (id: DocumentVersionId) => versions.get(id) ?? null),
    listVersions: vi.fn(),
    getDocument: vi.fn(),
    updateJurisdiction: vi.fn(),
  };

  const parsingRepository: ParsingRepository = {
    insertSegments: vi.fn(),
    getSegmentsByVersion: vi.fn(async (id: DocumentVersionId) => segments.get(id) ?? []),
    deleteSegmentsByVersion: vi.fn(),
    updateParseStatus: vi.fn(),
  };

  const scanningRepository: ScanningRepository = {
    insertCandidates: vi.fn(async (cands: CandidateMatch[], dvId: DocumentVersionId) => {
      const existing = candidates.get(dvId) ?? [];
      candidates.set(dvId, [...existing, ...cands]);
    }),
    getCandidatesByVersion: vi.fn(async (id: DocumentVersionId) => candidates.get(id) ?? []),
    deleteCandidatesByVersion: vi.fn(async (id: DocumentVersionId) => {
      candidates.delete(id);
    }),
    updateScanStatus: vi.fn(async (id: DocumentVersionId, status: ScanStatus, version: string) => {
      const v = versions.get(id);
      if (v) versions.set(id, { ...v, scanStatus: status, scannerVersion: version });
    }),
  };

  return {
    versions,
    segments,
    candidates,
    ingestionRepository,
    parsingRepository,
    scanningRepository,
  };
}

describe("scanning service", () => {
  let stubs: ReturnType<typeof createStubs>;
  let service: ReturnType<typeof createScanningService>;

  beforeEach(() => {
    stubs = createStubs();
    service = createScanningService({
      ...stubs,
      logger: createMockLogger(),
    });
  });

  it("scans a parsed document and returns results", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall, within 30 days, submit a report."),
      makeSegment("02", "The quick brown fox."),
    ]);

    const result = await service.scanDocument(dvId);
    expect(result.segmentResults).toHaveLength(2);
    expect(result.segmentResults[0]!.coverageState).toBe("candidates_found");
    expect(result.segmentResults[1]!.coverageState).toBe("screened_no_candidate");
    expect(result.totalCandidates).toBeGreaterThan(0);
  });

  it("is idempotent: returns existing when already scanned with same version", async () => {
    stubs.versions.set(dvId, makeVersion({ scanStatus: "scanned", scannerVersion: SCANNER_VERSION }));
    stubs.segments.set(dvId, [makeSegment("01", "Each agency shall submit.")]);
    stubs.candidates.set(dvId, [{
      candidateId: "cand_existing" as CandidateId,
      segmentId: "seg_01" as SegmentId,
      kind: "modal_verb",
      ruleId: "modal.shall",
      matchedText: "shall",
      matchStart: 12,
      matchEnd: 17,
      suppressed: false,
    }]);

    const result = await service.scanDocument(dvId);
    expect(result.totalCandidates).toBe(1);
    expect(stubs.scanningRepository.insertCandidates).not.toHaveBeenCalled();
  });

  it("re-scans when scanner version changes", async () => {
    stubs.versions.set(dvId, makeVersion({ scanStatus: "scanned", scannerVersion: "0.9.0" }));
    stubs.segments.set(dvId, [makeSegment("01", "Each agency shall submit.")]);

    const result = await service.scanDocument(dvId);
    expect(stubs.scanningRepository.deleteCandidatesByVersion).toHaveBeenCalledWith(dvId);
    expect(stubs.scanningRepository.insertCandidates).toHaveBeenCalled();
    expect(result.totalCandidates).toBeGreaterThan(0);
  });

  it("throws on document not found", async () => {
    await expect(service.scanDocument(dvId)).rejects.toThrow("not found");
  });

  it("throws on unparsed document", async () => {
    stubs.versions.set(dvId, makeVersion({ parseStatus: "unparsed" as ParseStatus }));
    await expect(service.scanDocument(dvId)).rejects.toThrow("not been parsed");
  });

  it("throws on parse_failed document", async () => {
    stubs.versions.set(dvId, makeVersion({ parseStatus: "parse_failed" as ParseStatus }));
    await expect(service.scanDocument(dvId)).rejects.toThrow("not been parsed");
  });

  it("all segments get a coverage state", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall submit."),
      makeSegment("02", "No temporal patterns here."),
      makeSegment("03", "1997, c. 795; 2019, c. 401."),
    ]);

    const result = await service.scanDocument(dvId);
    expect(result.segmentResults).toHaveLength(3);
    for (const seg of result.segmentResults) {
      expect(["candidates_found", "screened_no_candidate"]).toContain(seg.coverageState);
    }
  });

  it("persists candidates and updates scan_status", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [makeSegment("01", "This act shall become effective on July 1, 2025.")]);

    await service.scanDocument(dvId);
    expect(stubs.scanningRepository.insertCandidates).toHaveBeenCalledOnce();
    expect(stubs.scanningRepository.updateScanStatus).toHaveBeenCalledWith(dvId, "scanned", SCANNER_VERSION);
  });
});
