import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  sourceDocuments,
  documentVersions,
} from "./ingestion-schema.js";
import type { IngestionRepository } from "../../modules/ingestion/service.js";
import type {
  DocumentVersion,
  LegalIdentity,
  SourceDocument,
} from "../../modules/ingestion/types.js";
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
} from "../../modules/shared/types.js";

function rowToDocumentVersion(row: typeof documentVersions.$inferSelect): DocumentVersion {
  return {
    documentVersionId: row.documentVersionId as DocumentVersionId,
    documentId: row.documentId as DocumentId,
    contentHash: row.contentHash as ContentHash,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    legalIdentity: row.legalIdentity as LegalIdentity,
    legislativeStatus: row.legislativeStatus as LegislativeStatus,
    statusProvenance: row.statusProvenance as StatusProvenance,
    parseStatus: row.parseStatus as ParseStatus,
    scanStatus: row.scanStatus as ScanStatus,
    scannerVersion: row.scannerVersion,
    extractionStatus: row.extractionStatus as ExtractionStatus,
    extractorVersion: row.extractorVersion,
    anchoringStatus: row.anchoringStatus as AnchoringStatus,
    anchorerVersion: row.anchorerVersion,
    grammarStatus: row.grammarStatus as GrammarStatus,
    grammarVersion: row.grammarVersion,
    resolutionStatus: row.resolutionStatus as ResolutionStatus,
    resolverVersion: row.resolverVersion,
    evaluationStatus: row.evaluationStatus as EvaluationStatus,
    evaluatorVersion: row.evaluatorVersion,
    authoritativeSource: row.authoritativeSource,
    asOfDate: row.asOfDate,
    retrievedAt: row.retrievedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function createIngestionRepository(
  db: NodePgDatabase,
): IngestionRepository {
  return {
    async findOrCreateDocument(legalIdentity: LegalIdentity): Promise<DocumentId> {
      const [row] = await db
        .insert(sourceDocuments)
        .values({
          jurisdiction: legalIdentity.jurisdiction,
          session: legalIdentity.session,
          instrumentType: legalIdentity.instrumentType,
          number: legalIdentity.number,
          stage: legalIdentity.stage,
        })
        .onConflictDoUpdate({
          target: [
            sourceDocuments.jurisdiction,
            sourceDocuments.session,
            sourceDocuments.instrumentType,
            sourceDocuments.number,
            sourceDocuments.stage,
          ],
          set: { jurisdiction: sql`excluded.jurisdiction` },
        })
        .returning({ documentId: sourceDocuments.documentId });
      return row!.documentId as DocumentId;
    },

    async findVersionByHash(
      documentId: DocumentId,
      contentHash: ContentHash,
    ): Promise<DocumentVersion | null> {
      const rows = await db
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.contentHash, contentHash),
          ),
        )
        .limit(1);

      return rows.length > 0 ? rowToDocumentVersion(rows[0]!) : null;
    },

    async insertVersion(
      version: Omit<DocumentVersion, "createdAt">,
    ): Promise<DocumentVersion> {
      const [row] = await db
        .insert(documentVersions)
        .values({
          documentVersionId: version.documentVersionId,
          documentId: version.documentId,
          contentHash: version.contentHash,
          mimeType: version.mimeType,
          byteSize: version.byteSize,
          legalIdentity: version.legalIdentity,
          legislativeStatus: version.legislativeStatus,
          statusProvenance: version.statusProvenance,
          parseStatus: version.parseStatus,
          authoritativeSource: version.authoritativeSource,
          asOfDate: version.asOfDate,
          retrievedAt: new Date(version.retrievedAt),
        })
        .onConflictDoUpdate({
          target: [documentVersions.documentId, documentVersions.contentHash],
          set: { contentHash: sql`excluded.content_hash` },
        })
        .returning();

      return rowToDocumentVersion(row!);
    },

    async getVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentVersion | null> {
      const rows = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentVersionId, documentVersionId))
        .limit(1);

      return rows.length > 0 ? rowToDocumentVersion(rows[0]!) : null;
    },

    async listVersions(documentId: DocumentId): Promise<DocumentVersion[]> {
      const rows = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId));

      return rows.map(rowToDocumentVersion);
    },

    async getDocument(
      documentId: DocumentId,
    ): Promise<SourceDocument | null> {
      const rows = await db
        .select()
        .from(sourceDocuments)
        .where(eq(sourceDocuments.documentId, documentId))
        .limit(1);

      if (rows.length === 0) return null;
      const row = rows[0]!;
      return {
        documentId: row.documentId as DocumentId,
        jurisdiction: row.jurisdiction,
        session: row.session,
        instrumentType: row.instrumentType,
        number: row.number,
        stage: row.stage,
        createdAt: row.createdAt.toISOString(),
      };
    },
  };
}
