import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { resolutionResults } from "./resolver-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type {
  DocumentVersionId,
  AnchorId,
  SegmentId,
} from "../../modules/shared/types.js";
import {
  isResolvedDate,
  isResolvedRecurrence,
} from "../../modules/resolver/types.js";
import type {
  AnchoredResolution,
  Occurrence,
  ResolutionResult,
  ResolutionInput,
  ResolutionStatus,
} from "../../modules/resolver/types.js";
import type { TemporalExpression } from "../../modules/grammar/types.js";

function rowToAnchoredResolution(
  row: typeof resolutionResults.$inferSelect,
): AnchoredResolution {
  const expression = row.expression as unknown as TemporalExpression;
  const warnings = (row.warnings as string[]) ?? [];
  const inputs = (row.resolutionInputs as unknown as ResolutionInput[]) ?? [];

  let result: ResolutionResult;
  if (row.resolved && row.rrule) {
    const extra = row.recurrenceData as Record<string, unknown> | null;
    result = {
      resolved: true,
      recurrence: true,
      rrule: row.rrule,
      occurrences: (extra?.occurrences ?? []) as Occurrence[],
      horizon: (extra?.horizon as string) ?? "",
      yearParityNote: (extra?.yearParityNote as string) ?? null,
      ruleIds: (row.ruleIds as string[]) ?? [],
      citations: (row.citations as string[]) ?? [],
      packVersion: row.packVersion!,
      warnings,
      inputs,
    };
  } else if (row.resolved) {
    result = {
      resolved: true,
      statutoryDate: row.statutoryDate!,
      adjustedDate: row.adjustedDate!,
      ruleIds: (row.ruleIds as string[]) ?? [],
      citations: (row.citations as string[]) ?? [],
      packVersion: row.packVersion!,
      warnings,
      inputs,
    };
  } else {
    result = {
      resolved: false,
      reason: row.reason ?? "unknown",
      missingInputs: (row.missingInputs as string[]) ?? [],
      warnings,
      inputs,
    };
  }

  return {
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    text: row.inputText,
    expression,
    result,
  };
}

export interface ResolverRepository {
  insertResults(
    documentVersionId: DocumentVersionId,
    results: AnchoredResolution[],
    resolverVersion: string,
  ): Promise<void>;
  getResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<AnchoredResolution[]>;
  deleteResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateResolutionStatus(
    documentVersionId: DocumentVersionId,
    status: ResolutionStatus,
    resolverVersion: string,
  ): Promise<void>;
}

export function createResolverRepository(
  db: NodePgDatabase,
): ResolverRepository {
  return {
    async insertResults(
      documentVersionId: DocumentVersionId,
      results: AnchoredResolution[],
      resolverVersion: string,
    ): Promise<void> {
      if (results.length === 0) return;

      await db.insert(resolutionResults).values(
        results.map((r) => ({
          anchorId: r.anchorId,
          documentVersionId,
          segmentId: r.segmentId,
          inputText: r.text,
          expressionKind: r.expression.kind,
          expression: r.expression as unknown as Record<string, unknown>,
          resolved: r.result.resolved,
          statutoryDate: isResolvedDate(r.result) ? r.result.statutoryDate : null,
          adjustedDate: isResolvedDate(r.result) ? r.result.adjustedDate : null,
          rrule: isResolvedRecurrence(r.result) ? r.result.rrule : null,
          recurrenceData: isResolvedRecurrence(r.result)
            ? ({ occurrences: r.result.occurrences, horizon: r.result.horizon, yearParityNote: r.result.yearParityNote } as unknown as Record<string, unknown>)
            : null,
          ruleIds: r.result.resolved
            ? (r.result.ruleIds as unknown as Record<string, unknown>[])
            : null,
          citations: r.result.resolved
            ? (r.result.citations as unknown as Record<string, unknown>[])
            : null,
          packVersion: r.result.resolved ? r.result.packVersion : null,
          warnings: r.result.warnings as unknown as Record<string, unknown>[],
          reason: r.result.resolved ? null : r.result.reason,
          missingInputs: r.result.resolved
            ? null
            : (r.result.missingInputs as unknown as Record<string, unknown>[]),
          resolutionInputs: r.result.inputs as unknown as Record<
            string,
            unknown
          >[],
          resolverVersion,
        })),
      );
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<AnchoredResolution[]> {
      const rows = await db
        .select()
        .from(resolutionResults)
        .where(eq(resolutionResults.documentVersionId, documentVersionId));

      return rows.map(rowToAnchoredResolution);
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(resolutionResults)
        .where(eq(resolutionResults.documentVersionId, documentVersionId));
    },

    async updateResolutionStatus(
      documentVersionId: DocumentVersionId,
      status: ResolutionStatus,
      resolverVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({
          resolutionStatus: status,
          resolverVersion: resolverVersion,
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
