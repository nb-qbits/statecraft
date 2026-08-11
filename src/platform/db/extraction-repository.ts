import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { modelCalls } from "./extraction-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { ModelCallRecord } from "../../modules/extraction/types.js";
import type {
  DocumentVersionId,
  SegmentId,
  PromptHash,
  ModelCallId,
  ExtractionStatus,
} from "../../modules/shared/types.js";

function rowToModelCall(
  row: typeof modelCalls.$inferSelect,
): ModelCallRecord {
  return {
    modelCallId: row.modelCallId as ModelCallId,
    documentVersionId: row.documentVersionId as DocumentVersionId,
    segmentId: row.segmentId as SegmentId,
    modelId: row.modelId,
    promptHash: row.promptHash as PromptHash,
    requestPayload: row.requestPayload,
    responsePayload: row.responsePayload,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    correlationId: row.correlationId,
    repaired: row.repaired,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ExtractionRepository {
  insertCalls(calls: ModelCallRecord[]): Promise<void>;
  getCallsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<ModelCallRecord[]>;
  deleteCallsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateExtractionStatus(
    documentVersionId: DocumentVersionId,
    status: ExtractionStatus,
    extractorVersion: string,
  ): Promise<void>;
}

export function createExtractionRepository(
  db: NodePgDatabase,
): ExtractionRepository {
  return {
    async insertCalls(calls: ModelCallRecord[]): Promise<void> {
      if (calls.length === 0) return;

      await db.insert(modelCalls).values(
        calls.map((c) => ({
          modelCallId: c.modelCallId,
          documentVersionId: c.documentVersionId,
          segmentId: c.segmentId,
          modelId: c.modelId,
          promptHash: c.promptHash,
          requestPayload: c.requestPayload,
          responsePayload: c.responsePayload,
          inputTokens: c.inputTokens,
          outputTokens: c.outputTokens,
          latencyMs: c.latencyMs,
          correlationId: c.correlationId,
          repaired: c.repaired,
        })),
      );
    },

    async getCallsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<ModelCallRecord[]> {
      const rows = await db
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.documentVersionId, documentVersionId));

      return rows.map(rowToModelCall);
    },

    async deleteCallsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(modelCalls)
        .where(eq(modelCalls.documentVersionId, documentVersionId));
    },

    async updateExtractionStatus(
      documentVersionId: DocumentVersionId,
      status: ExtractionStatus,
      extractorVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ extractionStatus: status, extractorVersion })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
