import { eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { resolutionConflicts } from "./conflict-schema.js";
import type { DocumentVersionId } from "../../modules/shared/types.js";
import type { ResolutionConflict } from "../../modules/review/types.js";

function rowToConflict(
  row: typeof resolutionConflicts.$inferSelect,
): ResolutionConflict {
  return {
    conflictId: row.conflictId,
    documentVersionId: row.documentVersionId,
    anchorId: row.anchorId,
    recordId: row.recordId,
    previousStatutoryDate: row.previousStatutoryDate,
    previousAdjustedDate: row.previousAdjustedDate,
    newStatutoryDate: row.newStatutoryDate,
    newAdjustedDate: row.newAdjustedDate,
    newResolved: row.newResolved,
    previousGrammarVersion: row.previousGrammarVersion,
    newGrammarVersion: row.newGrammarVersion,
    previousResolverVersion: row.previousResolverVersion,
    newResolverVersion: row.newResolverVersion,
    status: row.status as ResolutionConflict["status"],
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}

export interface ConflictInsert {
  readonly documentVersionId: string;
  readonly anchorId: string;
  readonly recordId: string;
  readonly previousStatutoryDate: string;
  readonly previousAdjustedDate: string;
  readonly newStatutoryDate: string | null;
  readonly newAdjustedDate: string | null;
  readonly newResolved: boolean;
  readonly previousGrammarVersion: string;
  readonly newGrammarVersion: string;
  readonly previousResolverVersion: string;
  readonly newResolverVersion: string;
}

export interface ConflictRepository {
  insertConflict(conflict: ConflictInsert): Promise<ResolutionConflict>;
  getConflictsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<ResolutionConflict[]>;
  getPendingConflictsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<ResolutionConflict[]>;
  deleteConflictsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<number>;
}

export function createConflictRepository(
  db: NodePgDatabase,
): ConflictRepository {
  return {
    async insertConflict(
      conflict: ConflictInsert,
    ): Promise<ResolutionConflict> {
      const rows = await db
        .insert(resolutionConflicts)
        .values({
          documentVersionId: conflict.documentVersionId,
          anchorId: conflict.anchorId,
          recordId: conflict.recordId,
          previousStatutoryDate: conflict.previousStatutoryDate,
          previousAdjustedDate: conflict.previousAdjustedDate,
          newStatutoryDate: conflict.newStatutoryDate,
          newAdjustedDate: conflict.newAdjustedDate,
          newResolved: conflict.newResolved,
          previousGrammarVersion: conflict.previousGrammarVersion,
          newGrammarVersion: conflict.newGrammarVersion,
          previousResolverVersion: conflict.previousResolverVersion,
          newResolverVersion: conflict.newResolverVersion,
        })
        .returning();
      return rowToConflict(rows[0]!);
    },

    async getConflictsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<ResolutionConflict[]> {
      const rows = await db
        .select()
        .from(resolutionConflicts)
        .where(eq(resolutionConflicts.documentVersionId, documentVersionId))
        .orderBy(resolutionConflicts.createdAt);
      return rows.map(rowToConflict);
    },

    async getPendingConflictsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<ResolutionConflict[]> {
      const rows = await db
        .select()
        .from(resolutionConflicts)
        .where(
          and(
            eq(resolutionConflicts.documentVersionId, documentVersionId),
            eq(resolutionConflicts.status, "pending_review"),
          ),
        )
        .orderBy(resolutionConflicts.createdAt);
      return rows.map(rowToConflict);
    },

    async deleteConflictsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<number> {
      const deleted = await db
        .delete(resolutionConflicts)
        .where(eq(resolutionConflicts.documentVersionId, documentVersionId))
        .returning({ id: resolutionConflicts.conflictId });
      return deleted.length;
    },
  };
}
