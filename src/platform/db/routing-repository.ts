import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { routingResults, laneAssignments } from "./routing-schema.js";
import { documentVersions } from "./ingestion-schema.js";
import type { DocumentVersionId, RoutingStatus, Lane, AnchorId, SegmentId } from "../../modules/shared/types.js";
import type { DocumentRoutingResult, LaneAssignment, LaneReason } from "../../modules/routing/types.js";

function rowToLaneAssignment(
  row: typeof laneAssignments.$inferSelect,
): LaneAssignment {
  return {
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    lane: row.lane as Lane,
    reasons: row.reasons as unknown as readonly LaneReason[],
  };
}

function rowToResult(
  summaryRow: typeof routingResults.$inferSelect,
  assignments: LaneAssignment[],
): DocumentRoutingResult {
  return {
    documentVersionId: summaryRow.documentVersionId as DocumentVersionId,
    routerVersion: summaryRow.routerVersion,
    assignments,
    coverage: summaryRow.coverage as unknown as DocumentRoutingResult["coverage"],
    laneSummary: summaryRow.laneSummary as unknown as DocumentRoutingResult["laneSummary"],
    totalAssignments: summaryRow.totalAssignments,
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
  getAssignmentsByLane(
    lane: Lane,
    opts: { limit: number; offset: number },
  ): Promise<LaneAssignment[]>;
  getAssignmentsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<LaneAssignment[]>;
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

      if (result.assignments.length > 0) {
        await db.insert(laneAssignments).values(
          result.assignments.map((a) => ({
            anchorId: a.anchorId as string,
            documentVersionId,
            segmentId: a.segmentId as string,
            lane: a.lane,
            reasons: a.reasons as unknown as Record<string, unknown>,
            routerVersion: result.routerVersion,
          })),
        );
      }
    },

    async getResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentRoutingResult | null> {
      const summaryRows = await db
        .select()
        .from(routingResults)
        .where(eq(routingResults.documentVersionId, documentVersionId))
        .limit(1);

      if (summaryRows.length === 0) return null;

      const assignmentRows = await db
        .select()
        .from(laneAssignments)
        .where(eq(laneAssignments.documentVersionId, documentVersionId));

      return rowToResult(
        summaryRows[0]!,
        assignmentRows.map(rowToLaneAssignment),
      );
    },

    async deleteResultsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<void> {
      await db
        .delete(laneAssignments)
        .where(eq(laneAssignments.documentVersionId, documentVersionId));
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

    async getAssignmentsByLane(
      lane: Lane,
      opts: { limit: number; offset: number },
    ): Promise<LaneAssignment[]> {
      const rows = await db
        .select()
        .from(laneAssignments)
        .where(eq(laneAssignments.lane, lane))
        .orderBy(laneAssignments.documentVersionId, laneAssignments.anchorId)
        .limit(opts.limit)
        .offset(opts.offset);

      return rows.map(rowToLaneAssignment);
    },

    async getAssignmentsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<LaneAssignment[]> {
      const rows = await db
        .select()
        .from(laneAssignments)
        .where(eq(laneAssignments.documentVersionId, documentVersionId));

      return rows.map(rowToLaneAssignment);
    },
  };
}
