import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { routingResults } from "./routing-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { DocumentVersionId, RoutingStatus } from "../../modules/shared/types.js";
import type { DocumentRoutingResult } from "../../modules/routing/types.js";

function rowToResult(
  row: typeof routingResults.$inferSelect,
): DocumentRoutingResult {
  return {
    documentVersionId: row.documentVersionId as DocumentVersionId,
    routerVersion: row.routerVersion,
    assignments: row.assignments as unknown as DocumentRoutingResult["assignments"],
    coverage: row.coverage as unknown as DocumentRoutingResult["coverage"],
    laneSummary: row.laneSummary as unknown as DocumentRoutingResult["laneSummary"],
    totalAssignments: row.totalAssignments,
  };
}

export interface RoutingRepository {
  insertResults(
    documentVersionId: DocumentVersionId,
    result: DocumentRoutingResult,
  ): Promise<void>;
  getResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentRoutingResult | null>;
  deleteResultsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<void>;
  updateRoutingStatus(
    documentVersionId: DocumentVersionId,
    status: RoutingStatus,
    routerVersion: string,
  ): Promise<void>;
}

export function createRoutingRepository(
  db: NodePgDatabase,
): RoutingRepository {
  return {
    async insertResults(
      documentVersionId: DocumentVersionId,
      result: DocumentRoutingResult,
    ): Promise<void> {
      await db.insert(routingResults).values({
        documentVersionId,
        routerVersion: result.routerVersion,
        assignments: result.assignments as unknown as Record<string, unknown>,
        coverage: result.coverage as unknown as Record<string, unknown>,
        laneSummary: result.laneSummary as unknown as Record<string, unknown>,
        totalAssignments: result.totalAssignments,
      });
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentRoutingResult | null> {
      const rows = await db
        .select()
        .from(routingResults)
        .where(eq(routingResults.documentVersionId, documentVersionId))
        .limit(1);

      return rows.length > 0 ? rowToResult(rows[0]!) : null;
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(routingResults)
        .where(eq(routingResults.documentVersionId, documentVersionId));
    },

    async updateRoutingStatus(
      documentVersionId: DocumentVersionId,
      status: RoutingStatus,
      routerVersion: string,
    ): Promise<void> {
      await db
        .update(documentVersions)
        .set({ routingStatus: status, routerVersion })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    },
  };
}
