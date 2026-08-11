import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentVersionId, DocumentId, ContentHash, ParseStatus, SegmentId } from "../shared/types.js";
import type { DocumentVersion } from "../ingestion/types.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ObjectStorage } from "../../platform/storage/storage.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { SourceSegment, ParseResult, DocumentParser } from "./types.js";
import { createParsingService } from "./service.js";

const dvId = "dv-00000000-0000-0000-0000-000000000001" as DocumentVersionId;
const docId = "doc-00000000-0000-0000-0000-000000000001" as DocumentId;
const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as ContentHash;
const STUB_TEXT_VERSION = "1.3.0";
const STUB_DOCX_VERSION = "1.0.0";

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
    parseStatus: "unparsed",
    scanStatus: "unscanned",
    scannerVersion: null,
    extractionStatus: "unextracted",
    extractorVersion: null,
    authoritativeSource: null,
    asOfDate: null,
    retrievedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
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
  const files = new Map<string, Buffer>();

  const ingestionRepository: IngestionRepository = {
    findOrCreateDocument: vi.fn(),
    findVersionByHash: vi.fn(),
    insertVersion: vi.fn(),
    getVersion: vi.fn(async (id: DocumentVersionId) => versions.get(id) ?? null),
    listVersions: vi.fn(),
    getDocument: vi.fn(),
  };

  const parsingRepository: ParsingRepository = {
    insertSegments: vi.fn(async (segs: SourceSegment[]) => {
      if (segs.length > 0) {
        const key = segs[0]!.documentVersionId;
        segments.set(key, [...(segments.get(key) ?? []), ...segs]);
      }
    }),
    getSegmentsByVersion: vi.fn(async (id: DocumentVersionId) => segments.get(id) ?? []),
    deleteSegmentsByVersion: vi.fn(async (id: DocumentVersionId) => {
      segments.delete(id);
    }),
    updateParseStatus: vi.fn(async (id: DocumentVersionId, status: ParseStatus) => {
      const v = versions.get(id);
      if (v) versions.set(id, { ...v, parseStatus: status });
    }),
  };

  const storage: ObjectStorage = {
    put: vi.fn(),
    get: vi.fn(async (key: string) => {
      const buf = files.get(key);
      if (!buf) throw new Error(`Not found: ${key}`);
      return buf;
    }),
    exists: vi.fn(),
  };

  const plainTextParser: DocumentParser = {
    adapterId: "plain-text",
    version: STUB_TEXT_VERSION,
    parse(bytes: Buffer, mimeType: string): ParseResult {
      if (mimeType !== "text/plain") {
        return { ok: false, reason: "wrong mime", parserAdapter: "plain-text", parserVersion: STUB_TEXT_VERSION };
      }
      const text = bytes.toString("utf-8").trim();
      if (!text) {
        return { ok: false, reason: "empty", parserAdapter: "plain-text", parserVersion: STUB_TEXT_VERSION };
      }
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).map((p, i) => ({
        structuralPath: `/body/p[${i}]`,
        runs: [{ text: p.trim(), properties: { italic: false, strikethrough: false } }],
      }));
      return {
        ok: true,
        paragraphs,
        parserAdapter: "plain-text",
        parserVersion: STUB_TEXT_VERSION,
        fidelity: "none" as const,
      };
    },
  };

  const parseDocxFn = vi.fn(async (_bytes: Buffer): Promise<ParseResult> => {
    return {
      ok: true,
      paragraphs: [
        {
          structuralPath: "/body/p[0]",
          runs: [{ text: "DOCX content", properties: { italic: false, strikethrough: false } }],
        },
      ],
      parserAdapter: "docx",
      parserVersion: STUB_DOCX_VERSION,
      fidelity: "declared" as const,
    };
  });
  const parseDocx = Object.assign(parseDocxFn, { parserVersion: STUB_DOCX_VERSION });

  const STUB_PDF_VERSION = "1.0.0";
  const parsePdfFn = vi.fn(async (_bytes: Buffer): Promise<ParseResult> => {
    return {
      ok: true,
      paragraphs: [
        {
          structuralPath: "/body/p[0]",
          runs: [{ text: "PDF content", properties: { italic: false, strikethrough: false } }],
        },
      ],
      parserAdapter: "pdf",
      parserVersion: STUB_PDF_VERSION,
      fidelity: "inferred" as const,
    };
  });
  const parsePdf = Object.assign(parsePdfFn, { parserVersion: STUB_PDF_VERSION });

  return {
    versions,
    segments,
    files,
    ingestionRepository,
    parsingRepository,
    storage,
    plainTextParser,
    parseDocx,
    parsePdf,
  };
}

describe("parsing service", () => {
  let stubs: ReturnType<typeof createStubs>;
  let service: ReturnType<typeof createParsingService>;

  beforeEach(() => {
    stubs = createStubs();
    service = createParsingService({
      ...stubs,
      logger: createMockLogger(),
    });
  });

  it("parses a plain text document and returns segments", async () => {
    const version = makeVersion();
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("First paragraph.\n\nSecond paragraph."));

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(2);
    expect(result[0]!.rawText).toBe("First paragraph.");
    expect(result[1]!.rawText).toBe("Second paragraph.");
    expect(result[0]!.normalizedText).toBe("First paragraph.");
    expect(result[0]!.structuralPath).toBe("/body/p[0]");
    expect(result[0]!.fidelity).toBe("none");
    expect(result[0]!.segmentId).toMatch(/^seg_[0-9a-f]{32}$/);
  });

  it("parses a DOCX document and returns segments", async () => {
    const version = makeVersion({
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("fake docx"));

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawText).toBe("DOCX content");
    expect(result[0]!.fidelity).toBe("declared");
    expect(stubs.parseDocx).toHaveBeenCalled();
  });

  it("is idempotent: returns existing segments when already parsed", async () => {
    const version = makeVersion({ parseStatus: "parsed" });
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("text"));

    // Pre-populate segments
    const fakeSegments: SourceSegment[] = [{
      segmentId: "seg_existing" as SegmentId,
      documentVersionId: dvId,
      structuralPath: "/body/p[0]",
      ordinal: 0,
      rawText: "text",
      normalizedText: "text",
      contentHash: "hash" as ContentHash,
      offsetMap: { normalizedToOriginal: [0,1,2,3], originalToNormalized: [0,1,2,3] },
      parserAdapter: "plain-text",
      parserVersion: STUB_TEXT_VERSION,
      fidelity: "none",
    }];
    stubs.segments.set(dvId, fakeSegments);

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(1);
    expect(result[0]!.segmentId).toBe("seg_existing");
    expect(stubs.storage.get).not.toHaveBeenCalled();
  });

  it("parses a PDF document and returns segments", async () => {
    const version = makeVersion({ mimeType: "application/pdf" });
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("fake pdf bytes"));

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawText).toBe("PDF content");
    expect(result[0]!.fidelity).toBe("inferred");
    expect(stubs.parsePdf).toHaveBeenCalled();
  });

  it("scanned PDF with no text layer produces parse_failed", async () => {
    const version = makeVersion({ mimeType: "application/pdf" });
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("fake pdf bytes"));

    stubs.parsePdf.mockResolvedValueOnce({
      ok: false,
      reason: "Scanned PDF with no extractable text",
      parserAdapter: "pdf",
      parserVersion: "1.0.0",
    });

    await expect(service.parseDocument(dvId)).rejects.toThrow("Parsing failed");
    expect(stubs.parsingRepository.updateParseStatus).toHaveBeenCalledWith(dvId, "parse_failed");
  });

  it("throws on parse_failed status (no silent retry)", async () => {
    const version = makeVersion({ parseStatus: "parse_failed" });
    stubs.versions.set(dvId, version);

    await expect(service.parseDocument(dvId)).rejects.toThrow("previously failed parsing");
  });

  it("throws on document not found", async () => {
    await expect(service.parseDocument(dvId)).rejects.toThrow("not found");
  });

  it("sets parse_failed on parser failure and throws", async () => {
    const version = makeVersion();
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from(""));

    await expect(service.parseDocument(dvId)).rejects.toThrow("Parsing failed");
    expect(stubs.parsingRepository.updateParseStatus).toHaveBeenCalledWith(dvId, "parse_failed");
  });

  it("produces deterministic segment IDs across calls", async () => {
    const version1 = makeVersion();
    stubs.versions.set(dvId, version1);
    stubs.files.set(`documents/${hash}`, Buffer.from("Stable content."));

    const result1 = await service.parseDocument(dvId);

    // Reset for second run
    stubs.segments.clear();
    stubs.versions.set(dvId, makeVersion());

    const result2 = await service.parseDocument(dvId);
    expect(result1[0]!.segmentId).toBe(result2[0]!.segmentId);
  });

  it("gives identical subsections distinct segment IDs via ordinals", async () => {
    const version = makeVersion();
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("Same text.\n\nSame text."));

    // Override parser to produce same structural path for both
    stubs.plainTextParser.parse = (_bytes, _mime) => ({
      ok: true as const,
      paragraphs: [
        {
          structuralPath: "/body/p[0]",
          runs: [{ text: "Same text.", properties: { italic: false, strikethrough: false } }],
        },
        {
          structuralPath: "/body/p[0]",
          runs: [{ text: "Same text.", properties: { italic: false, strikethrough: false } }],
        },
      ],
      parserAdapter: "plain-text",
      parserVersion: STUB_TEXT_VERSION,
      fidelity: "none" as const,
    });

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(2);
    expect(result[0]!.segmentId).not.toBe(result[1]!.segmentId);
    expect(result[0]!.ordinal).toBe(0);
    expect(result[1]!.ordinal).toBe(1);
  });

  it("inserts segments and updates parse status in sequence", async () => {
    const version = makeVersion();
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("Content."));

    await service.parseDocument(dvId);

    expect(stubs.parsingRepository.insertSegments).toHaveBeenCalledOnce();
    expect(stubs.parsingRepository.updateParseStatus).toHaveBeenCalledWith(dvId, "parsed");
  });

  it("offset map is populated on segments", async () => {
    const version = makeVersion();
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("Hello world."));

    const result = await service.parseDocument(dvId);
    const seg = result[0]!;
    expect(seg.offsetMap.normalizedToOriginal).toHaveLength(seg.normalizedText.length);
    expect(seg.offsetMap.originalToNormalized).toHaveLength(seg.rawText.length);
  });

  it("re-parses when stored parser version differs from current", async () => {
    const version = makeVersion({ parseStatus: "parsed" });
    stubs.versions.set(dvId, version);
    stubs.files.set(`documents/${hash}`, Buffer.from("Re-parsed content."));

    const staleSegments: SourceSegment[] = [{
      segmentId: "seg_stale" as SegmentId,
      documentVersionId: dvId,
      structuralPath: "/body/p[0]",
      ordinal: 0,
      rawText: "Old content.",
      normalizedText: "Old content.",
      contentHash: "oldhash" as ContentHash,
      offsetMap: { normalizedToOriginal: [0,1,2,3], originalToNormalized: [0,1,2,3] },
      parserAdapter: "plain-text",
      parserVersion: "0.9.0",
      fidelity: "none",
    }];
    stubs.segments.set(dvId, staleSegments);

    const result = await service.parseDocument(dvId);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawText).toBe("Re-parsed content.");
    expect(result[0]!.parserVersion).toBe(STUB_TEXT_VERSION);
    expect(stubs.parsingRepository.deleteSegmentsByVersion).toHaveBeenCalledWith(dvId);
  });
});
