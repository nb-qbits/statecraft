import type {
  DocumentId,
  DocumentVersionId,
  ContentHash,
  LegislativeStatus,
} from "../shared/types.js";

export interface LegalIdentity {
  readonly jurisdiction: string;
  readonly session: string;
  readonly instrumentType: string;
  readonly number: string;
  readonly stage: string;
  readonly chapter: string | null;
}

export interface DocumentVersion {
  readonly documentVersionId: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: ContentHash;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly legalIdentity: LegalIdentity;
  readonly legislativeStatus: LegislativeStatus;
  readonly authoritativeSource: string | null;
  readonly asOfDate: string | null;
  readonly retrievedAt: string;
  readonly createdAt: string;
}

export interface SourceDocument {
  readonly documentId: DocumentId;
  readonly createdAt: string;
}

export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
