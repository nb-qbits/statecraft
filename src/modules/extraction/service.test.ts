import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DocumentVersionId,
  DocumentId,
  ContentHash,
  SegmentId,
  CandidateId,
  ScanStatus,
  ExtractionStatus,
  ModelCallId,
  PromptHash,
} from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment } from "../parsing/types.js";
import type { CandidateMatch } from "../scanning/types.js";
import type { ModelCallRecord } from "./types.js";
import type { ModelGateway, ModelResponse } from "./model-gateway.js";
import { createExtractionService, EXTRACTOR_VERSION } from "./service.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash =
  "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;

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
    extractionStatus: "unextracted",
    extractorVersion: null,
    anchoringStatus: "unanchored",
    anchorerVersion: null,
    grammarStatus: "unparsed_grammar",
    grammarVersion: null,
    resolutionStatus: "unresolved_resolver",
    resolverVersion: null,
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

function makeCandidate(
  segmentId: string,
  kind: string,
  matchedText: string,
): CandidateMatch {
  return {
    candidateId: `cand_${segmentId}_${kind}` as CandidateId,
    segmentId: segmentId as SegmentId,
    kind: kind as CandidateMatch["kind"],
    ruleId: `test.${kind}`,
    matchedText,
    matchStart: 0,
    matchEnd: matchedText.length,
    suppressed: false,
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

function createMockModelGateway(
  parsedContent: unknown = { proposals: [] },
): ModelGateway {
  return {
    call: vi.fn(async (): Promise<ModelResponse> => ({
      modelCallId: "mcall_test123" as ModelCallId,
      modelId: "test-model",
      promptHash: "ph_test" as PromptHash,
      requestPayload: "{}",
      responsePayload: JSON.stringify(parsedContent),
      parsedContent,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 10,
      correlationId: "corr-test",
    })),
  };
}

function createStubs() {
  const versions = new Map<string, DocumentVersion>();
  const segments = new Map<string, SourceSegment[]>();
  const candidates = new Map<string, CandidateMatch[]>();
  const calls = new Map<string, ModelCallRecord[]>();

  const ingestionRepository: IngestionRepository = {
    findOrCreateDocument: vi.fn(),
    findVersionByHash: vi.fn(),
    insertVersion: vi.fn(),
    getVersion: vi.fn(
      async (id: DocumentVersionId) => versions.get(id) ?? null,
    ),
    listVersions: vi.fn(),
    getDocument: vi.fn(),
  };

  const parsingRepository: ParsingRepository = {
    insertSegments: vi.fn(),
    getSegmentsByVersion: vi.fn(
      async (id: DocumentVersionId) => segments.get(id) ?? [],
    ),
    deleteSegmentsByVersion: vi.fn(),
    updateParseStatus: vi.fn(),
  };

  const scanningRepository: ScanningRepository = {
    insertCandidates: vi.fn(),
    getCandidatesByVersion: vi.fn(
      async (id: DocumentVersionId) => candidates.get(id) ?? [],
    ),
    deleteCandidatesByVersion: vi.fn(),
    updateScanStatus: vi.fn(),
  };

  const extractionRepository: ExtractionRepository = {
    insertCalls: vi.fn(async (newCalls: ModelCallRecord[]) => {
      for (const c of newCalls) {
        const existing = calls.get(c.documentVersionId) ?? [];
        existing.push(c);
        calls.set(c.documentVersionId, existing);
      }
    }),
    getCallsByVersion: vi.fn(
      async (id: DocumentVersionId) => calls.get(id) ?? [],
    ),
    deleteCallsByVersion: vi.fn(async (id: DocumentVersionId) => {
      calls.delete(id);
    }),
    updateExtractionStatus: vi.fn(
      async (
        id: DocumentVersionId,
        status: ExtractionStatus,
        version: string,
      ) => {
        const v = versions.get(id);
        if (v)
          versions.set(id, {
            ...v,
            extractionStatus: status,
            extractorVersion: version,
          });
      },
    ),
  };

  return {
    versions,
    segments,
    candidates,
    calls,
    ingestionRepository,
    parsingRepository,
    scanningRepository,
    extractionRepository,
  };
}

describe("extraction service", () => {
  let stubs: ReturnType<typeof createStubs>;

  beforeEach(() => {
    stubs = createStubs();
  });

  function makeService(gateway?: ModelGateway) {
    return createExtractionService({
      ...stubs,
      modelGateway: gateway ?? createMockModelGateway(),
      modelId: "test-model",
      logger: createMockLogger(),
    });
  }

  it("extracts proposals from segments with candidates", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall, within 30 days, submit a report."),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "duration", "within 30 days"),
      makeCandidate("seg_01", "modal_verb", "shall"),
    ]);

    const gateway = createMockModelGateway({
      proposals: [
        {
          segmentId: "seg_01",
          quotedText: "within 30 days",
          kind: "duration",
        },
      ],
    });

    const service = makeService(gateway);
    const result = await service.extractDocument(dvId);

    expect(result.totalProposals).toBe(1);
    expect(result.totalSegmentsProcessed).toBe(1);
    expect(result.segmentResults[0]!.proposals[0]!.quotedText).toBe(
      "within 30 days",
    );
  });

  it("skips segments with only suppressed candidates", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "1997, c. 795; 2019, c. 401."),
      makeSegment("02", "Each agency shall submit."),
    ]);
    stubs.candidates.set(dvId, [
      { ...makeCandidate("seg_02", "modal_verb", "shall"), suppressed: false },
    ]);

    const service = makeService();
    const result = await service.extractDocument(dvId);

    expect(result.totalSegmentsSkipped).toBe(1);
    expect(result.totalSegmentsProcessed).toBe(1);
  });

  it("skips segments with no candidates at all", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "No temporal patterns here."),
    ]);
    stubs.candidates.set(dvId, []);

    const service = makeService();
    const result = await service.extractDocument(dvId);

    expect(result.totalSegmentsSkipped).toBe(1);
    expect(result.totalSegmentsProcessed).toBe(0);
  });

  it("flags repaired responses in provenance", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall submit."),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "modal_verb", "shall"),
    ]);

    const gateway = createMockModelGateway({
      proposals: [
        {
          segmentId: "seg_wrong",
          quotedText: "shall submit",
          kind: "obligation_deadline",
        },
      ],
    });

    const service = makeService(gateway);
    const result = await service.extractDocument(dvId);

    expect(result.totalRepaired).toBe(1);
    expect(result.segmentResults[0]!.repaired).toBe(true);
    expect(result.segmentResults[0]!.proposals[0]!.segmentId).toBe("seg_01");
  });

  it("counts repaired responses in run metrics", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Text 1"),
      makeSegment("02", "Text 2"),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "modal_verb", "shall"),
      makeCandidate("seg_02", "duration", "30 days"),
    ]);

    const callCount = { value: 0 };
    const gateway: ModelGateway = {
      call: vi.fn(async (): Promise<ModelResponse> => {
        callCount.value++;
        const content =
          callCount.value === 1
            ? {
                proposals: [
                  {
                    segmentId: "seg_wrong",
                    quotedText: "text",
                    kind: "duration",
                  },
                ],
              }
            : {
                proposals: [
                  {
                    segmentId: "seg_02",
                    quotedText: "30 days",
                    kind: "duration",
                  },
                ],
              };
        return {
          modelCallId: `mcall_${callCount.value}` as ModelCallId,
          modelId: "test-model",
          promptHash: "ph_test" as PromptHash,
          requestPayload: "{}",
          responsePayload: JSON.stringify(content),
          parsedContent: content,
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 10,
          correlationId: "corr",
        };
      }),
    };

    const service = makeService(gateway);
    const result = await service.extractDocument(dvId);

    expect(result.totalRepaired).toBe(1);
    expect(result.totalProposals).toBe(2);
  });

  it("is idempotent: returns existing when already extracted with same version", async () => {
    stubs.versions.set(
      dvId,
      makeVersion({
        extractionStatus: "extracted",
        extractorVersion: EXTRACTOR_VERSION,
      }),
    );

    const existingCall: ModelCallRecord = {
      modelCallId: "mcall_existing" as ModelCallId,
      documentVersionId: dvId,
      segmentId: "seg_01" as SegmentId,
      modelId: "test-model",
      promptHash: "ph_test" as PromptHash,
      requestPayload: "{}",
      responsePayload: JSON.stringify({
        proposals: [
          {
            segmentId: "seg_01",
            quotedText: "within 30 days",
            kind: "duration",
          },
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 10,
      correlationId: "corr",
      repaired: false,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    stubs.calls.set(dvId, [existingCall]);

    const gateway = createMockModelGateway();
    const service = makeService(gateway);
    const result = await service.extractDocument(dvId);

    expect(result.totalProposals).toBe(1);
    expect(gateway.call).not.toHaveBeenCalled();
  });

  it("re-extracts when extractor version changes", async () => {
    stubs.versions.set(
      dvId,
      makeVersion({
        extractionStatus: "extracted",
        extractorVersion: "0.9.0",
        scanStatus: "scanned",
      }),
    );
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall submit."),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "modal_verb", "shall"),
    ]);

    const service = makeService();
    await service.extractDocument(dvId);

    expect(stubs.extractionRepository.deleteCallsByVersion).toHaveBeenCalledWith(
      dvId,
    );
    expect(stubs.extractionRepository.insertCalls).toHaveBeenCalled();
  });

  it("throws on document not found", async () => {
    const service = makeService();
    await expect(service.extractDocument(dvId)).rejects.toThrow("not found");
  });

  it("throws on unscanned document", async () => {
    stubs.versions.set(
      dvId,
      makeVersion({ scanStatus: "unscanned" as ScanStatus }),
    );
    const service = makeService();
    await expect(service.extractDocument(dvId)).rejects.toThrow(
      "not been scanned",
    );
  });

  it("persists model calls and updates extraction_status", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall submit."),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "modal_verb", "shall"),
    ]);

    const service = makeService();
    await service.extractDocument(dvId);

    expect(stubs.extractionRepository.insertCalls).toHaveBeenCalledOnce();
    expect(
      stubs.extractionRepository.updateExtractionStatus,
    ).toHaveBeenCalledWith(dvId, "extracted", EXTRACTOR_VERSION);
  });

  it("records model call provenance including promptHash and modelId", async () => {
    stubs.versions.set(dvId, makeVersion());
    stubs.segments.set(dvId, [
      makeSegment("01", "Each agency shall submit."),
    ]);
    stubs.candidates.set(dvId, [
      makeCandidate("seg_01", "modal_verb", "shall"),
    ]);

    const service = makeService();
    const result = await service.extractDocument(dvId);

    expect(result.segmentResults[0]!.modelCallId).toMatch(/^mcall_/);

    const insertedCalls = (
      stubs.extractionRepository.insertCalls as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as ModelCallRecord[];
    expect(insertedCalls[0]!.modelId).toBe("test-model");
    expect(insertedCalls[0]!.promptHash).toMatch(/^ph_/);
  });
});
