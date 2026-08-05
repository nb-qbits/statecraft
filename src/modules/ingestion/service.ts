import { createHash } from "node:crypto";
import type { ObjectStorage } from "../../platform/storage/storage.js";
import type { LegislativeMetadataSource } from "./legislative-metadata.js";
import type { LegalIdentity, DocumentVersion } from "./types.js";
import { SUPPORTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./types.js";
import type {
  DocumentId,
  DocumentVersionId,
  ContentHash,
  LegislativeStatus,
} from "../shared/types.js";
import {
  unsupportedMimeType,
  fileTooLarge,
  corruptFile,
} from "./errors.js";
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
  getDocument(documentId: DocumentId): Promise<{ documentId: DocumentId; createdAt: string } | null>;
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
      // Validate mime type
      if (!isSupportedMimeType(input.mimeType)) {
        throw unsupportedMimeType(input.mimeType);
      }

      // Validate file size
      if (input.bytes.length > MAX_FILE_SIZE_BYTES) {
        throw fileTooLarge(input.bytes.length, MAX_FILE_SIZE_BYTES);
      }

      // Validate content integrity
      if (
        input.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        validateDocxSignature(input.bytes);
      } else if (input.mimeType === "text/plain") {
        validateTextContent(input.bytes);
      }

      const contentHash = computeContentHash(input.bytes);

      // Resolve document: explicit ID or find-or-create by legal identity
      let documentId: DocumentId;
      if (input.documentId) {
        const doc = await repository.getDocument(input.documentId);
        if (!doc) {
          throw new (await import("../shared/errors.js")).AppError({
            code: "DOCUMENT_NOT_FOUND",
            category: "user_input",
            message: `Document ${input.documentId} not found`,
            retryable: false,
            context: { documentId: input.documentId },
          });
        }
        documentId = input.documentId;
      } else {
        documentId = await repository.findOrCreateDocument(input.legalIdentity);
      }

      // Check for duplicate
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

      // Store immutable bytes keyed by SHA-256
      const storageKey = `documents/${contentHash}`;
      const alreadyStored = await storage.exists(storageKey);
      if (!alreadyStored) {
        await storage.put(storageKey, input.bytes, input.mimeType);
      }

      // Resolve legislative status
      let legislativeStatus: LegislativeStatus =
        input.legislativeStatus ?? "unknown";

      if (legislativeStatus === "unknown") {
        const metadata = await metadataSource.lookup(input.legalIdentity);
        if (metadata) {
          legislativeStatus = metadata.legislativeStatus;
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

      const version = await repository.insertVersion({
        documentVersionId: crypto.randomUUID() as DocumentVersionId,
        documentId,
        contentHash,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        legalIdentity: input.legalIdentity,
        legislativeStatus,
        authoritativeSource: input.authoritativeSource ?? null,
        asOfDate: input.asOfDate ?? null,
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
