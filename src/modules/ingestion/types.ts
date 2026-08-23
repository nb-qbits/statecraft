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

export interface LegalIdentity {
  readonly jurisdiction: string;
  readonly session: string;
  readonly instrumentType: string;
  readonly number: string;
  readonly stage: string;
  readonly chapter: string | null;
  readonly shortTitle?: string | undefined;
}

export interface DocumentVersion {
  readonly documentVersionId: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: ContentHash;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly legalIdentity: LegalIdentity;
  readonly legislativeStatus: LegislativeStatus;
  readonly statusProvenance: StatusProvenance;
  readonly authoritativeSource: string | null;
  readonly asOfDate: string | null;
  readonly parseStatus: ParseStatus;
  readonly scanStatus: ScanStatus;
  readonly scannerVersion: string | null;
  readonly extractionStatus: ExtractionStatus;
  readonly extractorVersion: string | null;
  readonly anchoringStatus: AnchoringStatus;
  readonly anchorerVersion: string | null;
  readonly grammarStatus: GrammarStatus;
  readonly grammarVersion: string | null;
  readonly resolutionStatus: ResolutionStatus;
  readonly resolverVersion: string | null;
  readonly evaluationStatus: EvaluationStatus;
  readonly evaluatorVersion: string | null;
  readonly routingStatus: RoutingStatus;
  readonly routerVersion: string | null;
  readonly retrievedAt: string;
  readonly createdAt: string;
}

export interface SourceDocument {
  readonly documentId: DocumentId;
  readonly jurisdiction: string;
  readonly session: string;
  readonly instrumentType: string;
  readonly number: string;
  readonly stage: string;
  readonly createdAt: string;
}

export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
