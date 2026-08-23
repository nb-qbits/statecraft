import { createHash, randomUUID } from "node:crypto";
import type { ObjectStorage } from "../../platform/storage/storage.js";
import type { LegislativeMetadataSource } from "./legislative-metadata.js";
import type { LegalIdentity, DocumentVersion, SourceDocument } from "./types.js";
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./types.js";
import type {
  DocumentId,
  DocumentVersionId,
  ContentHash,
  LegislativeStatus,
  StatusProvenance,
  ParseStatus,
  ScanStatus,
  ExtractionStatus,
  AnchoringStatus,
  GrammarStatus,
  ResolutionStatus,
  EvaluationStatus,
  RoutingStatus,
} from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import {
  unsupportedMimeType,
  fileTooLarge,
  corruptFile,
  missingStatusProvenance,
  identityMismatch,
} from "./errors.js";
import { normalizeJurisdiction } from "./jurisdiction.js";
import type { Logger } from "../../platform/logger/logger.js";

export interface IngestionRepository {
  findOrCreateDocument(legalIdentity: LegalIdentity): Promise<DocumentId>;
  findVersionByHash(
    documentId: DocumentId,
    contentHash: ContentHash,
  ): Promise<DocumentVersion | null>;
  insertVersion(version: Omit<DocumentVersion, "createdAt">): Promise<DocumentVersion>;
  getVersion(documentVersionId: DocumentVersionId): Promise<DocumentVersion | null>;
  listVersions(documentId: DocumentId): Promise<DocumentVersion[]>;
  getDocument(documentId: DocumentId): Promise<SourceDocument | null>;
  updateJurisdiction(documentVersionId: DocumentVersionId, jurisdiction: string): Promise<void>;
  updateLegalIdentity(documentVersionId: DocumentVersionId, updates: Partial<LegalIdentity>): Promise<void>;
  listAnalysedVersions(): Promise<DocumentVersion[]>;
}

export interface UploadInput {
  documentId?: DocumentId;
  bytes: Buffer;
  mimeType: string;
  legalIdentity: LegalIdentity;
  legislativeStatus?: LegislativeStatus;
  authoritativeSource?: string;
  asOfDate?: string;
}

function computeContentHash(bytes: Buffer): ContentHash {
  return createHash("sha256").update(bytes).digest("hex") as ContentHash;
}

function isSupportedMimeType(
  mimeType: string,
): mimeType is (typeof SUPPORTED_MIME_TYPES)[number] {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

function validateDocxSignature(bytes: Buffer): void {
  // DOCX files are ZIP archives; PK magic bytes
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw corruptFile("DOCX file has invalid ZIP signature");
  }
}

function validatePdfSignature(bytes: Buffer): void {
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
    throw corruptFile("PDF file does not begin with %PDF- signature");
  }
}

function validateTextContent(bytes: Buffer): void {
  if (bytes.length === 0) {
    throw corruptFile("File is empty");
  }
  // Check for null bytes that indicate a binary file masquerading as text
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0x00) {
      throw corruptFile(
        "File contains null bytes — likely a binary file with incorrect mime type",
      );
    }
  }
}

export function createIngestionService(deps: {
  repository: IngestionRepository;
  storage: ObjectStorage;
  metadataSource: LegislativeMetadataSource;
  logger: Logger;
}) {
  const { repository, storage, metadataSource, logger } = deps;

  return {
    async upload(input: UploadInput): Promise<DocumentVersion> {
      if (!isSupportedMimeType(input.mimeType)) {
        throw unsupportedMimeType(input.mimeType);
      }

      if (input.bytes.length > MAX_FILE_SIZE_BYTES) {
        throw fileTooLarge(input.bytes.length, MAX_FILE_SIZE_BYTES);
      }

      if (
        input.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        validateDocxSignature(input.bytes);
      } else if (input.mimeType === "text/plain") {
        validateTextContent(input.bytes);
      } else if (input.mimeType === "application/pdf") {
        validatePdfSignature(input.bytes);
      }

      // Normalize jurisdiction to canonical form
      const legalIdentity: LegalIdentity = {
        ...input.legalIdentity,
        jurisdiction: normalizeJurisdiction(input.legalIdentity.jurisdiction),
      };

      // HIGH 1: caller-asserted status requires provenance
      const callerStatus = input.legislativeStatus;
      if (
        callerStatus !== undefined &&
        callerStatus !== "unknown" &&
        (!input.authoritativeSource || !input.asOfDate)
      ) {
        throw missingStatusProvenance(callerStatus);
      }

      const contentHash = computeContentHash(input.bytes);

      // Resolve document: explicit ID or find-or-create by legal identity
      let documentId: DocumentId;
      if (input.documentId) {
        const doc = await repository.getDocument(input.documentId);
        if (!doc) {
          throw new AppError({
            code: "DOCUMENT_NOT_FOUND",
            category: "user_input",
            message: `Document ${input.documentId} not found`,
            retryable: false,
            context: { documentId: input.documentId },
          });
        }

        // HIGH 2: validate legal identity matches parent document
        const tupleFields = [
          "jurisdiction", "session", "instrumentType", "number", "stage",
        ] as const;
        for (const field of tupleFields) {
          if (legalIdentity[field] !== doc[field]) {
            throw identityMismatch(
              input.documentId,
              field,
              doc[field],
              legalIdentity[field],
            );
          }
        }

        documentId = input.documentId;
      } else {
        documentId = await repository.findOrCreateDocument(legalIdentity);
      }

      // Check for duplicate (fast path — avoids storage.put)
      const existing = await repository.findVersionByHash(
        documentId,
        contentHash,
      );
      if (existing) {
        logger.info(
          { documentId, contentHash },
          "duplicate version detected, returning existing",
        );
        return existing;
      }

      // Store immutable bytes keyed by SHA-256 (idempotent — same key = same bytes)
      const storageKey = `documents/${contentHash}`;
      const alreadyStored = await storage.exists(storageKey);
      if (!alreadyStored) {
        await storage.put(storageKey, input.bytes, input.mimeType);
      }

      // Resolve legislative status and track provenance
      let legislativeStatus: LegislativeStatus = "unknown";
      let statusProvenance: StatusProvenance = "default_unknown";
      let authoritativeSource = input.authoritativeSource ?? null;
      let asOfDate = input.asOfDate ?? null;

      if (callerStatus !== undefined && callerStatus !== "unknown") {
        legislativeStatus = callerStatus;
        statusProvenance = "caller_asserted";
      } else {
        const metadata = await metadataSource.lookup(legalIdentity);
        if (metadata) {
          legislativeStatus = metadata.legislativeStatus;
          statusProvenance = "metadata_source";
          authoritativeSource = metadata.authoritativeSource ?? authoritativeSource;
          asOfDate = metadata.asOfDate ?? asOfDate;
          logger.info(
            {
              documentId,
              provider: metadataSource.provider,
              legislativeStatus,
            },
            "legislative status resolved from metadata source",
          );
        }
      }

      const now = new Date().toISOString();

      // HIGH 3: insertVersion is conflict-safe — concurrent identical uploads
      // both succeed; the second returns the existing row via ON CONFLICT
      // PDF parsing is deferred to a later module; all uploads start as unparsed
      const parseStatus: ParseStatus = "unparsed";

      const version = await repository.insertVersion({
        documentVersionId: randomUUID() as DocumentVersionId,
        documentId,
        contentHash,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        legalIdentity,
        legislativeStatus,
        statusProvenance,
        authoritativeSource,
        asOfDate,
        parseStatus,
        scanStatus: "unscanned" as ScanStatus,
        scannerVersion: null,
        extractionStatus: "unextracted" as ExtractionStatus,
        extractorVersion: null,
        anchoringStatus: "unanchored" as AnchoringStatus,
        anchorerVersion: null,
        grammarStatus: "unparsed_grammar" as GrammarStatus,
        grammarVersion: null,
        resolutionStatus: "unresolved_resolver" as ResolutionStatus,
        resolverVersion: null,
        evaluationStatus: "unevaluated" as EvaluationStatus,
        evaluatorVersion: null,
        routingStatus: "unrouted" as RoutingStatus,
        routerVersion: null,
        retrievedAt: now,
      });

      logger.info(
        {
          documentId,
          documentVersionId: version.documentVersionId,
          contentHash,
          mimeType: input.mimeType,
          byteSize: input.bytes.length,
          legislativeStatus,
          statusProvenance,
        },
        "document version created",
      );

      return version;
    },

    async getVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentVersion | null> {
      return repository.getVersion(documentVersionId);
    },

    async listVersions(documentId: DocumentId): Promise<DocumentVersion[]> {
      return repository.listVersions(documentId);
    },
  };
}
