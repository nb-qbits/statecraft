import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { anchorResults } from "./anchoring-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { ProposalAnchorResult } from "../../modules/anchoring/types.js";
import type {
  DocumentVersionId,
  SegmentId,
  AnchorId,
  AnchoringStatus,
  AnchorMethod,
} from "../../modules/shared/types.js";
import type { SpanProposalKind } from "../../modules/extraction/types.js";

function rowToProposalResult(
  row: typeof anchorResults.$inferSelect,
): ProposalAnchorResult {
  const base = {
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    quotedText: row.quotedText,
    kind: row.kind as SpanProposalKind,
  };

  if (row.anchored) {
    return {
      ...base,
      result: {
        anchored: true,
        normalizedStart: row.normalizedStart!,
        normalizedEnd: row.normalizedEnd!,
        originalStart: row.originalStart!,
        originalEnd: row.originalEnd!,
        method: row.method as AnchorMethod,
      },
    };
  }

  return {
    ...base,
    result: {
      anchored: false,
      reason: row.reason ?? "unknown",
    },
  };
}

export interface AnchoringRepository {
  insertResults(
    documentVersionId: DocumentVersionId,
    results: ProposalAnchorResult[],
    anchorerVersion: string,
  ): Promise<void>;
  getResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<ProposalAnchorResult[]>;
  deleteResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateAnchoringStatus(
    documentVersionId: DocumentVersionId,
    status: AnchoringStatus,
    anchorerVersion: string,
  ): Promise<void>;
}

export function createAnchoringRepository(
  db: NodePgDatabase,
): AnchoringRepository {
  return {
    async insertResults(
      documentVersionId: DocumentVersionId,
      results: ProposalAnchorResult[],
      anchorerVersion: string,
    ): Promise<void> {
      if (results.length === 0) return;

      await db.insert(anchorResults).values(
        results.map((r) => ({
          anchorId: r.anchorId,
          documentVersionId,
          segmentId: r.segmentId,
          quotedText: r.quotedText,
          kind: r.kind,
          anchored: r.result.anchored,
          method: r.result.anchored ? r.result.method : null,
          normalizedStart: r.result.anchored ? r.result.normalizedStart : null,
          normalizedEnd: r.result.anchored ? r.result.normalizedEnd : null,
          originalStart: r.result.anchored ? r.result.originalStart : null,
          originalEnd: r.result.anchored ? r.result.originalEnd : null,
          reason: r.result.anchored ? null : r.result.reason,
          anchorerVersion,
        })),
      );
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<ProposalAnchorResult[]> {
      const rows = await db
        .select()
        .from(anchorResults)
        .where(eq(anchorResults.documentVersionId, documentVersionId));

      return rows.map(rowToProposalResult);
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(anchorResults)
        .where(eq(anchorResults.documentVersionId, documentVersionId));
    },

    async updateAnchoringStatus(
      documentVersionId: DocumentVersionId,
      status: AnchoringStatus,
      anchorerVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ anchoringStatus: status, anchorerVersion })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
