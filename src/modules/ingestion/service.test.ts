import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { createIngestionService, type IngestionRepository } from "./service.js";
import type { ObjectStorage } from "../../platform/storage/storage.js";
import type { DocumentVersion, LegalIdentity, SourceDocument } from "./types.js";
import type {
  DocumentId,
  DocumentVersionId,
  ContentHash,
} from "../shared/types.js";
import { createNullMetadataSource } from "./legislative-metadata.js";
import type { LegislativeMetadataSource } from "./legislative-metadata.js";
import { createLogger } from "../../platform/logger/logger.js";
import { AppError } from "../shared/errors.js";

const VALID_LEGAL_IDENTITY: LegalIdentity = {
  jurisdiction: "Virginia",
  session: "2025",
  instrumentType: "HB",
  number: "1234",
  stage: "introduced",
  chapter: null,
};

const TEXT_CONTENT = Buffer.from("Section 1. This act shall take effect July 1, 2026.");
const TEXT_CONTENT_2 = Buffer.from("Section 2. Different content entirely.");

const DOCX_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const VALID_DOCX = Buffer.concat([DOCX_HEADER, Buffer.alloc(100)]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_PDF = readFileSync(
  resolve(__dirname, "../../../fixtures/sample-bill.pdf"),
);

function createMemoryStorage(): ObjectStorage & {
  stored: Map<string, { body: Buffer; contentType: string }>;
} {
  const stored = new Map<string, { body: Buffer; contentType: string }>();
  return {
    stored,
    async put(key: string, body: Buffer, contentType: string) {
      stored.set(key, { body, contentType });
    },
    async get(key: string) {
      const item = stored.get(key);
      if (!item) throw new Error(`Not found: ${key}`);
      return item.body;
    },
    async exists(key: string) {
      return stored.has(key);
    },
  };
}

function legalIdentityKey(li: LegalIdentity): string {
  return `${li.jurisdiction}|${li.session}|${li.instrumentType}|${li.number}|${li.stage}`;
}

function createMemoryRepository(): IngestionRepository & {
  documents: Map<string, SourceDocument>;
  versions: Map<string, DocumentVersion>;
} {
  const documents = new Map<string, SourceDocument>();
  const identityIndex = new Map<string, DocumentId>();
  const versions = new Map<string, DocumentVersion>();
  let docCounter = 0;

  return {
    documents,
    versions,
    async findOrCreateDocument(legalIdentity: LegalIdentity): Promise<DocumentId> {
      const key = legalIdentityKey(legalIdentity);
      const existing = identityIndex.get(key);
      if (existing) return existing;
      const id = `doc-${++docCounter}` as DocumentId;
      documents.set(id, {
        documentId: id,
        jurisdiction: legalIdentity.jurisdiction,
        session: legalIdentity.session,
        instrumentType: legalIdentity.instrumentType,
        number: legalIdentity.number,
        stage: legalIdentity.stage,
        createdAt: new Date().toISOString(),
      });
      identityIndex.set(key, id);
      return id;
    },
    async findVersionByHash(
      documentId: DocumentId,
      contentHash: ContentHash,
    ): Promise<DocumentVersion | null> {
      for (const v of versions.values()) {
        if (v.documentId === documentId && v.contentHash === contentHash) {
          return v;
        }
      }
      return null;
    },
    async insertVersion(
      version: Omit<DocumentVersion, "createdAt">,
    ): Promise<DocumentVersion> {
      // Conflict-safe: return existing on (documentId, contentHash) match
      for (const v of versions.values()) {
        if (v.documentId === version.documentId && v.contentHash === version.contentHash) {
          return v;
        }
      }
      const full: DocumentVersion = {
        ...version,
        createdAt: new Date().toISOString(),
      };
      versions.set(version.documentVersionId, full);
      return full;
    },
    async getVersion(id: DocumentVersionId): Promise<DocumentVersion | null> {
      return versions.get(id) ?? null;
    },
    async listVersions(documentId: DocumentId): Promise<DocumentVersion[]> {
      return [...versions.values()].filter(
        (v) => v.documentId === documentId,
      );
    },
    async getDocument(documentId: DocumentId): Promise<SourceDocument | null> {
      return documents.get(documentId) ?? null;
    },
  };
}

const logger = createLogger("silent");

describe("createIngestionService", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let repository: ReturnType<typeof createMemoryRepository>;
  let metadataSource: LegislativeMetadataSource;

  beforeEach(() => {
    storage = createMemoryStorage();
    repository = createMemoryRepository();
    metadataSource = createNullMetadataSource();
  });

  function makeService(overrides?: {
    metadataSource?: LegislativeMetadataSource;
  }) {
    return createIngestionService({
      repository,
      storage,
      metadataSource: overrides?.metadataSource ?? metadataSource,
      logger,
    });
  }

  describe("upload — happy path", () => {
    it("creates a document and version for text/plain", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(version.documentVersionId).toBeDefined();
      expect(version.documentId).toBeDefined();
      expect(version.mimeType).toBe("text/plain");
      expect(version.byteSize).toBe(TEXT_CONTENT.length);
      expect(version.contentHash).toHaveLength(64);
      expect(version.legalIdentity).toEqual({
        ...VALID_LEGAL_IDENTITY,
        jurisdiction: "us-va",
      });
      expect(version.legislativeStatus).toBe("unknown");
      expect(version.statusProvenance).toBe("default_unknown");
    });

    it("creates a document and version for DOCX", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: VALID_DOCX,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(version.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });

    it("stores bytes in object storage keyed by SHA-256", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      const key = `documents/${version.contentHash}`;
      expect(storage.stored.has(key)).toBe(true);
      expect(storage.stored.get(key)!.body).toEqual(TEXT_CONTENT);
    });

    it("accepts an explicit legislativeStatus with provenance", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
        legislativeStatus: "enacted",
        authoritativeSource: "https://lis.virginia.gov/bill/HB1234",
        asOfDate: "2025-07-01",
      });

      expect(version.legislativeStatus).toBe("enacted");
      expect(version.statusProvenance).toBe("caller_asserted");
      expect(version.authoritativeSource).toBe("https://lis.virginia.gov/bill/HB1234");
      expect(version.asOfDate).toBe("2025-07-01");
    });
  });

  describe("upload — deduplication", () => {
    it("identical bytes uploaded twice produce one version", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        documentId: v1.documentId,
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(v1.documentVersionId).toBe(v2.documentVersionId);
      expect(v1.contentHash).toBe(v2.contentHash);
      expect(repository.versions.size).toBe(1);
    });

    it("different bytes produce two versions", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        documentId: v1.documentId,
        bytes: TEXT_CONTENT_2,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(v1.documentVersionId).not.toBe(v2.documentVersionId);
      expect(v1.contentHash).not.toBe(v2.contentHash);
      expect(repository.versions.size).toBe(2);
    });

    it("same legal identity without documentId routes to same document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(v1.documentId).toBe(v2.documentId);
      expect(v1.documentVersionId).toBe(v2.documentVersionId);
      expect(repository.documents.size).toBe(1);
    });

    it("different legal identity creates different documents", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: {
          ...VALID_LEGAL_IDENTITY,
          number: "5678",
        },
      });

      expect(v1.documentId).not.toBe(v2.documentId);
      expect(repository.documents.size).toBe(2);
    });

    it("does not re-upload bytes to storage on duplicate", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      let putCount = 0;
      const origPut = storage.put.bind(storage);
      storage.put = async (...args: Parameters<typeof storage.put>) => {
        putCount++;
        return origPut(...args);
      };

      await svc.upload({
        documentId: v1.documentId,
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(putCount).toBe(0);
    });
  });

  describe("upload — validation errors", () => {
    it("rejects unsupported mime type", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: Buffer.from("{}"),
          mimeType: "application/json",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("UNSUPPORTED_MIME_TYPE");
        expect((err as AppError).category).toBe("user_input");
      }
    });

    it("rejects oversized files", async () => {
      const svc = makeService();
      const bigBuffer = Buffer.alloc(51 * 1024 * 1024);
      try {
        await svc.upload({
          bytes: bigBuffer,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("FILE_TOO_LARGE");
      }
    });

    it("rejects corrupt DOCX (no ZIP signature)", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: Buffer.from("not a zip file"),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
      }
    });

    it("rejects empty text files", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: Buffer.alloc(0),
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
      }
    });

    it("rejects binary content in text/plain", async () => {
      const svc = makeService();
      const binaryContent = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f]);
      try {
        await svc.upload({
          bytes: binaryContent,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
        expect((err as AppError).message).toContain("null bytes");
      }
    });

    it("corrupt and unsupported files are never marked successful", async () => {
      const svc = makeService();

      // Ensure no version was persisted
      const sizeBefore = repository.versions.size;

      try {
        await svc.upload({
          bytes: Buffer.from("{}"),
          mimeType: "application/json",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
      } catch {
        // expected
      }

      try {
        await svc.upload({
          bytes: Buffer.from("not a zip"),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
      } catch {
        // expected
      }

      expect(repository.versions.size).toBe(sizeBefore);
      expect(storage.stored.size).toBe(0);
    });
  });

  describe("upload — PDF support", () => {
    it("accepts a valid PDF file", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: VALID_PDF,
        mimeType: "application/pdf",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(version.documentVersionId).toBeDefined();
      expect(version.mimeType).toBe("application/pdf");
      expect(version.byteSize).toBe(VALID_PDF.length);
      expect(version.contentHash).toHaveLength(64);
    });

    it("rejects PDF with wrong magic bytes as CORRUPT_FILE", async () => {
      const svc = makeService();
      const fakeBytes = Buffer.from("Not a real PDF file content");
      try {
        await svc.upload({
          bytes: fakeBytes,
          mimeType: "application/pdf",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
        expect((err as AppError).message).toContain("%PDF-");
      }
    });

    it("rejects a PDF renamed to .txt (mime/content mismatch)", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: VALID_PDF,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
        expect((err as AppError).message).toContain("null bytes");
      }
    });

    it("rejects an empty buffer as PDF", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: Buffer.alloc(0),
          mimeType: "application/pdf",
          legalIdentity: VALID_LEGAL_IDENTITY,
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("CORRUPT_FILE");
      }
    });
  });

  describe("upload — parseStatus defaults to unparsed", () => {
    it("text/plain upload has parseStatus 'unparsed'", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(version.parseStatus).toBe("unparsed");
    });

    it("DOCX upload has parseStatus 'unparsed'", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: VALID_DOCX,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(version.parseStatus).toBe("unparsed");
    });

    it("PDF upload has parseStatus 'unparsed'", async () => {
      const svc = makeService();
      const version = await svc.upload({
        bytes: VALID_PDF,
        mimeType: "application/pdf",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(version.parseStatus).toBe("unparsed");
    });

    it("deduplicated upload preserves parseStatus 'unparsed'", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v1.parseStatus).toBe("unparsed");
      expect(v2.parseStatus).toBe("unparsed");
    });
  });

  describe("upload — legislativeStatus", () => {
    it("defaults to unknown when no status provided and no metadata source", async () => {
      const svc = makeService();
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.legislativeStatus).toBe("unknown");
    });

    it("unknown is queryable and distinguishable from enacted", async () => {
      const svc = makeService();
      const vUnknown = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const vEnacted = await svc.upload({
        bytes: TEXT_CONTENT_2,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
        legislativeStatus: "enacted",
        authoritativeSource: "https://lis.virginia.gov/bill/HB1234",
        asOfDate: "2025-07-01",
      });

      expect(vUnknown.legislativeStatus).toBe("unknown");
      expect(vEnacted.legislativeStatus).toBe("enacted");
      expect(vUnknown.legislativeStatus).not.toBe(vEnacted.legislativeStatus);

      // Both are retrievable
      const fetched1 = await svc.getVersion(vUnknown.documentVersionId);
      const fetched2 = await svc.getVersion(vEnacted.documentVersionId);
      expect(fetched1).not.toBeNull();
      expect(fetched2).not.toBeNull();
      expect(fetched1!.legislativeStatus).toBe("unknown");
      expect(fetched2!.legislativeStatus).toBe("enacted");
    });

    it("resolves status from metadata source when no explicit status", async () => {
      const mockSource: LegislativeMetadataSource = {
        provider: "test",
        async lookup() {
          return {
            legislativeStatus: "enacted" as const,
            authoritativeSource: "https://example.com/bill/123",
            asOfDate: "2025-07-01",
          };
        },
      };

      const svc = makeService({ metadataSource: mockSource });
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.legislativeStatus).toBe("enacted");
    });

    it("does not call metadata source when status is explicitly provided", async () => {
      let lookupCalled = false;
      const mockSource: LegislativeMetadataSource = {
        provider: "test",
        async lookup() {
          lookupCalled = true;
          return {
            legislativeStatus: "enacted" as const,
            authoritativeSource: null,
            asOfDate: null,
          };
        },
      };

      const svc = makeService({ metadataSource: mockSource });
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
        legislativeStatus: "introduced",
        authoritativeSource: "https://lis.virginia.gov/bill/HB1234",
        asOfDate: "2025-01-15",
      });
      expect(v.legislativeStatus).toBe("introduced");
      expect(v.statusProvenance).toBe("caller_asserted");
      expect(lookupCalled).toBe(false);
    });

    it("stays unknown when metadata source returns null", async () => {
      const mockSource: LegislativeMetadataSource = {
        provider: "test",
        async lookup() {
          return null;
        },
      };

      const svc = makeService({ metadataSource: mockSource });
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.legislativeStatus).toBe("unknown");
    });

    it("stays unknown when metadata source returns null on error", async () => {
      const svc = makeService({
        metadataSource: {
          provider: "safe-broken",
          async lookup() {
            return null;
          },
        },
      });
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.legislativeStatus).toBe("unknown");
    });
  });

  describe("upload — status provenance (HIGH 1)", () => {
    it("rejects caller-asserted status without authoritativeSource", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: TEXT_CONTENT,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
          legislativeStatus: "enacted",
          asOfDate: "2025-07-01",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("MISSING_STATUS_PROVENANCE");
      }
    });

    it("rejects caller-asserted status without asOfDate", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: TEXT_CONTENT,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
          legislativeStatus: "vetoed",
          authoritativeSource: "https://example.com",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("MISSING_STATUS_PROVENANCE");
      }
    });

    it("rejects caller-asserted status without either provenance field", async () => {
      const svc = makeService();
      try {
        await svc.upload({
          bytes: TEXT_CONTENT,
          mimeType: "text/plain",
          legalIdentity: VALID_LEGAL_IDENTITY,
          legislativeStatus: "enacted",
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("MISSING_STATUS_PROVENANCE");
      }
    });

    it("allows unknown status without provenance", async () => {
      const svc = makeService();
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
        legislativeStatus: "unknown",
      });
      expect(v.legislativeStatus).toBe("unknown");
      expect(v.statusProvenance).toBe("default_unknown");
    });

    it("records metadata_source provenance from adapter", async () => {
      const mockSource: LegislativeMetadataSource = {
        provider: "test",
        async lookup() {
          return {
            legislativeStatus: "enacted" as const,
            authoritativeSource: "https://openstates.org/bill/123",
            asOfDate: "2025-06-15",
          };
        },
      };

      const svc = makeService({ metadataSource: mockSource });
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.statusProvenance).toBe("metadata_source");
      expect(v.authoritativeSource).toBe("https://openstates.org/bill/123");
      expect(v.asOfDate).toBe("2025-06-15");
    });
  });

  describe("upload — identity mismatch (HIGH 2)", () => {
    it("rejects version with mismatched jurisdiction on existing document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      try {
        await svc.upload({
          documentId: v1.documentId,
          bytes: TEXT_CONTENT_2,
          mimeType: "text/plain",
          legalIdentity: {
            ...VALID_LEGAL_IDENTITY,
            jurisdiction: "Maryland",
          },
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("IDENTITY_MISMATCH");
        expect((err as AppError).context.field).toBe("jurisdiction");
      }
    });

    it("rejects version with mismatched number on existing document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      try {
        await svc.upload({
          documentId: v1.documentId,
          bytes: TEXT_CONTENT_2,
          mimeType: "text/plain",
          legalIdentity: {
            ...VALID_LEGAL_IDENTITY,
            number: "9999",
          },
        });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("IDENTITY_MISMATCH");
        expect((err as AppError).context.field).toBe("number");
      }
    });

    it("allows version with different chapter on existing document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      const v2 = await svc.upload({
        documentId: v1.documentId,
        bytes: TEXT_CONTENT_2,
        mimeType: "text/plain",
        legalIdentity: {
          ...VALID_LEGAL_IDENTITY,
          chapter: "123",
        },
      });

      expect(v2.documentId).toBe(v1.documentId);
      expect(v2.legalIdentity.chapter).toBe("123");
    });
  });

  describe("upload — race condition (HIGH 3)", () => {
    it("insertVersion is conflict-safe on (documentId, contentHash)", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      // Simulate a race: repository.findVersionByHash returns null
      // even though a version exists, then insertVersion handles the conflict
      const origFind = repository.findVersionByHash.bind(repository);
      let skipOnce = true;
      repository.findVersionByHash = async (docId, hash) => {
        if (skipOnce) {
          skipOnce = false;
          return null;
        }
        return origFind(docId, hash);
      };

      const v2 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      expect(v2.documentVersionId).toBe(v1.documentVersionId);
      expect(repository.versions.size).toBe(1);
    });
  });

  describe("upload — jurisdiction normalization (MEDIUM 4)", () => {
    it("normalizes 'Virginia' to 'us-va'", async () => {
      const svc = makeService();
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      expect(v.legalIdentity.jurisdiction).toBe("us-va");
    });

    it("'Virginia' and 'us-va' route to the same document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: { ...VALID_LEGAL_IDENTITY, jurisdiction: "Virginia" },
      });
      const v2 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: { ...VALID_LEGAL_IDENTITY, jurisdiction: "us-va" },
      });
      expect(v1.documentId).toBe(v2.documentId);
      expect(v1.documentVersionId).toBe(v2.documentVersionId);
    });

    it("case-insensitive normalization ('VA' → 'us-va')", async () => {
      const svc = makeService();
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: { ...VALID_LEGAL_IDENTITY, jurisdiction: "VA" },
      });
      expect(v.legalIdentity.jurisdiction).toBe("us-va");
    });
  });

  describe("getVersion and listVersions", () => {
    it("retrieves a version by ID", async () => {
      const svc = makeService();
      const v = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      const fetched = await svc.getVersion(v.documentVersionId);
      expect(fetched).toEqual(v);
    });

    it("returns null for nonexistent version", async () => {
      const svc = makeService();
      const fetched = await svc.getVersion(
        "nonexistent" as DocumentVersionId,
      );
      expect(fetched).toBeNull();
    });

    it("lists all versions for a document", async () => {
      const svc = makeService();
      const v1 = await svc.upload({
        bytes: TEXT_CONTENT,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });
      const v2 = await svc.upload({
        documentId: v1.documentId,
        bytes: TEXT_CONTENT_2,
        mimeType: "text/plain",
        legalIdentity: VALID_LEGAL_IDENTITY,
      });

      const versions = await svc.listVersions(v1.documentId);
      expect(versions).toHaveLength(2);
      const ids = versions.map((v) => v.documentVersionId);
      expect(ids).toContain(v1.documentVersionId);
      expect(ids).toContain(v2.documentVersionId);
    });
  });
});
