import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sourceSegments } from "./parsing-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { SourceSegment } from "../../modules/parsing/types.js";
import type { ParseStatus } from "../../modules/shared/types.js";
import type {
  SegmentId,
  DocumentVersionId,
  ContentHash,
  Fidelity,
} from "../../modules/shared/types.js";
import { compressOffsetMap, expandOffsetMap, isCompressedOffsetMap } from "../../modules/parsing/offset-map.js";

function rowToSegment(row: typeof sourceSegments.$inferSelect): SourceSegment {
  const stored = row.offsetMap as Record<string, unknown>;
  const offsetMap = isCompressedOffsetMap(stored)
    ? expandOffsetMap(stored)
    : stored as unknown as SourceSegment["offsetMap"];

  return {
    segmentId: row.segmentId as SegmentId,
    documentVersionId: row.documentVersionId as DocumentVersionId,
    structuralPath: row.structuralPath,
    ordinal: row.ordinal,
    rawText: row.rawText,
    normalizedText: row.normalizedText,
    contentHash: row.contentHash as ContentHash,
    offsetMap,
    parserAdapter: row.parserAdapter,
    parserVersion: row.parserVersion,
    fidelity: row.fidelity as Fidelity,
  };
}

export interface ParsingRepository {
  insertSegments(segments: SourceSegment[]): Promise<void>;
  getSegmentsByVersion(documentVersionId: DocumentVersionId): Promise<SourceSegment[]>;
  deleteSegmentsByVersion(documentVersionId: DocumentVersionId): Promise<void>;
  updateParseStatus(documentVersionId: DocumentVersionId, status: ParseStatus): Promise<void>;
}

export function createParsingRepository(
  db: NodePgDatabase,
): ParsingRepository {
  return {
    async insertSegments(segments: SourceSegment[]): Promise<void> {
      if (segments.length === 0) return;

      await db.insert(sourceSegments).values(
        segments.map((s) => ({
          segmentId: s.segmentId,
          documentVersionId: s.documentVersionId,
          structuralPath: s.structuralPath,
          ordinal: s.ordinal,
          rawText: s.rawText,
          normalizedText: s.normalizedText,
          contentHash: s.contentHash,
          offsetMap: compressOffsetMap(s.offsetMap),
          parserAdapter: s.parserAdapter,
          parserVersion: s.parserVersion,
          fidelity: s.fidelity,
        })),
      );
    },

    async deleteSegmentsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(sourceSegments)
        .where(eq(sourceSegments.documentVersionId, documentVersionId));
    },

    async getSegmentsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<SourceSegment[]> {
      const rows = await db
        .select()
        .from(sourceSegments)
        .where(eq(sourceSegments.documentVersionId, documentVersionId))
        .orderBy(sourceSegments.ordinal);

      return rows.map(rowToSegment);
    },

    async updateParseStatus(
      documentVersionId: DocumentVersionId,
      status: ParseStatus,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ parseStatus: status })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
