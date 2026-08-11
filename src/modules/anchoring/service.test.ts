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
import { createAnchoringService, computeAnchorId } from "./service.js";
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
    parserVersion: "1.3.0",
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
      makeVersion({ anchoringStatus: "anchored", anchorerVersion: "1.0.0" }),
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
      "1.0.0",
    );
  });

  it("computeAnchorId is deterministic", () => {
    const id1 = computeAnchorId(segId, "within 30 days", "duration");
    const id2 = computeAnchorId(segId, "within 30 days", "duration");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^anc_[0-9a-f]{32}$/);
  });
});
