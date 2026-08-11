import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { grammarResults } from "./grammar-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type {
  DocumentVersionId,
  AnchorId,
  SegmentId,
  GrammarStatus,
} from "../../modules/shared/types.js";
import type { SpanParseResult, TemporalExpression } from "../../modules/grammar/types.js";

function rowToSpanParseResult(
  row: typeof grammarResults.$inferSelect,
): SpanParseResult {
  if (row.parsed) {
    return {
      anchorId: row.anchorId as AnchorId,
      segmentId: row.segmentId as SegmentId,
      text: row.inputText,
      result: {
        parsed: true,
        expression: row.expression as unknown as TemporalExpression,
      },
    };
  }
  return {
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    text: row.inputText,
    result: {
      parsed: false,
      reason: row.failureReason ?? "unknown",
      position: row.failurePosition ?? 0,
    },
  };
}

export interface GrammarRepository {
  insertResults(
    documentVersionId: DocumentVersionId,
    results: SpanParseResult[],
    grammarVersion: string,
  ): Promise<void>;
  getResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<SpanParseResult[]>;
  deleteResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateGrammarStatus(
    documentVersionId: DocumentVersionId,
    status: GrammarStatus,
    grammarVersion: string,
  ): Promise<void>;
}

export function createGrammarRepository(
  db: NodePgDatabase,
): GrammarRepository {
  return {
    async insertResults(
      documentVersionId: DocumentVersionId,
      results: SpanParseResult[],
      grammarVersion: string,
    ): Promise<void> {
      if (results.length === 0) return;

      await db.insert(grammarResults).values(
        results.map((r) => ({
          anchorId: r.anchorId,
          documentVersionId,
          segmentId: r.segmentId,
          inputText: r.text,
          parsed: r.result.parsed,
          expression: r.result.parsed ? (r.result.expression as unknown as Record<string, unknown>) : null,
          failureReason: r.result.parsed ? null : r.result.reason,
          failurePosition: r.result.parsed ? null : r.result.position,
          grammarVersion,
        })),
      );
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<SpanParseResult[]> {
      const rows = await db
        .select()
        .from(grammarResults)
        .where(eq(grammarResults.documentVersionId, documentVersionId));

      return rows.map(rowToSpanParseResult);
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(grammarResults)
        .where(eq(grammarResults.documentVersionId, documentVersionId));
    },

    async updateGrammarStatus(
      documentVersionId: DocumentVersionId,
      status: GrammarStatus,
      grammarVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ grammarStatus: status, grammarVersion: grammarVersion })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
