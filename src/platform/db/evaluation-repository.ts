import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { evaluationResults } from "./evaluation-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type {
  DocumentVersionId,
  AnchorId,
  SegmentId,
  EvaluationStatus,
  EvaluatorVerdict,
  SupportLevel,
  PromptHash,
} from "../../modules/shared/types.js";
import type { SpanEvaluation, DeterministicCheckSummary } from "../../modules/evaluation/types.js";

function rowToSpanEvaluation(
  row: typeof evaluationResults.$inferSelect,
): SpanEvaluation {
  return {
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    quotedText: row.quotedText,
    deterministicResult: row.deterministicChecks as unknown as DeterministicCheckSummary,
    evaluatorVerdict: row.evaluatorVerdict as EvaluatorVerdict | null,
    supportLevel: row.supportLevel as SupportLevel,
  };
}

export interface EvaluationRepository {
  insertResults(
    documentVersionId: DocumentVersionId,
    evaluations: SpanEvaluation[],
    evaluatorVersion: string,
    promptHash: PromptHash,
  ): Promise<void>;
  getResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<SpanEvaluation[]>;
  deleteResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateEvaluationStatus(
    documentVersionId: DocumentVersionId,
    status: EvaluationStatus,
    evaluatorVersion: string,
  ): Promise<void>;
}

export function createEvaluationRepository(
  db: NodePgDatabase,
): EvaluationRepository {
  return {
    async insertResults(
      documentVersionId: DocumentVersionId,
      evaluations: SpanEvaluation[],
      evaluatorVersion: string,
      promptHash: PromptHash,
    ): Promise<void> {
      if (evaluations.length === 0) return;

      await db.insert(evaluationResults).values(
        evaluations.map((e) => ({
          anchorId: e.anchorId,
          documentVersionId,
          segmentId: e.segmentId,
          quotedText: e.quotedText,
          deterministicPassed: e.deterministicResult.allPassed,
          deterministicChecks: e.deterministicResult as unknown as Record<string, unknown>,
          evaluatorVerdict: e.evaluatorVerdict,
          supportLevel: e.supportLevel,
          promptHash,
          evaluatorVersion,
        })),
      );
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<SpanEvaluation[]> {
      const rows = await db
        .select()
        .from(evaluationResults)
        .where(eq(evaluationResults.documentVersionId, documentVersionId));

      return rows.map(rowToSpanEvaluation);
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(evaluationResults)
        .where(eq(evaluationResults.documentVersionId, documentVersionId));
    },

    async updateEvaluationStatus(
      documentVersionId: DocumentVersionId,
      status: EvaluationStatus,
      evaluatorVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({
          evaluationStatus: status,
          evaluatorVersion: evaluatorVersion,
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
