import { eq, and, desc, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createHash } from "node:crypto";
import {
  projects,
  analyses,
  proposals,
  reviewEvents,
  registerRecords,
  idempotencyKeys,
} from "./review-schema.js";
import { deadlineOccurrences } from "./occurrence-schema.js";
import { evaluationResults } from "./evaluation-schema.js";
import type { Occurrence } from "../../modules/resolver/types.js";
import type {
  DocumentVersionId,
  ProjectId,
  AnalysisId,
  ProposalId,
  ReviewEventId,
  RegisterRecordId,
  RecordVersionId,
  AnchorId,
  SegmentId,
  SupportLevel,
  Lane,
} from "../../modules/shared/types.js";
import type {
  Project,
  Analysis,
  AnalysisStatus,
  ReviewProposal,
  ProposalStatus,
  ReviewEvent,
  ReviewAction,
  ReviewDiff,
  RegisterRecord,
  RecordStatus,
  DateProvenance,
} from "../../modules/review/types.js";
import type { LaneReason } from "../../modules/routing/types.js";

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    projectId: row.projectId as ProjectId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToAnalysis(row: typeof analyses.$inferSelect): Analysis {
  return {
    analysisId: row.analysisId as AnalysisId,
    documentVersionId: row.documentVersionId as DocumentVersionId,
    configHash: row.configHash,
    stageVersions: row.stageVersions as Record<string, string> | null,
    status: row.status as AnalysisStatus,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function rowToProposal(row: typeof proposals.$inferSelect): ReviewProposal {
  return {
    proposalId: row.proposalId as ProposalId,
    analysisId: row.analysisId as AnalysisId,
    documentVersionId: row.documentVersionId as DocumentVersionId,
    anchorId: row.anchorId as AnchorId,
    segmentId: row.segmentId as SegmentId,
    quotedText: row.quotedText,
    kind: row.kind,
    normalizedStart: row.normalizedStart,
    normalizedEnd: row.normalizedEnd,
    originalStart: row.originalStart,
    originalEnd: row.originalEnd,
    anchoringMethod: row.anchoringMethod,
    parsedExpression: row.parsedExpression as Record<string, unknown> | null,
    resolved: row.resolved,
    statutoryDate: row.statutoryDate,
    adjustedDate: row.adjustedDate,
    rrule: row.rrule ?? null,
    ruleIds: (row.ruleIds as string[]) ?? [],
    citations: (row.citations as string[]) ?? [],
    packVersion: row.packVersion,
    actor: row.actor ?? null,
    actorQuotedText: row.actorQuotedText ?? null,
    dependsOnDescription: row.dependsOnDescription ?? null,
    supportLevel: row.supportLevel as SupportLevel,
    lane: row.lane as Lane,
    laneReasons: (row.laneReasons as unknown as LaneReason[]) ?? [],
    status: row.status as ProposalStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToReviewEvent(
  row: typeof reviewEvents.$inferSelect,
): ReviewEvent {
  return {
    eventId: row.eventId as ReviewEventId,
    proposalId: row.proposalId as ProposalId | null,
    action: row.action as ReviewAction,
    reviewerId: row.reviewerId,
    beforeValues: row.beforeValues as Record<string, unknown> | null,
    afterValues: row.afterValues as Record<string, unknown>,
    diff: (row.diff as unknown as ReviewDiff[]) ?? [],
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToRegisterRecord(
  row: typeof registerRecords.$inferSelect,
): RegisterRecord {
  return {
    recordId: row.recordId as RegisterRecordId,
    recordVersionId: row.recordVersionId as RecordVersionId,
    proposalId: row.proposalId as ProposalId | null,
    reviewEventId: row.reviewEventId as ReviewEventId,
    documentVersionId: row.documentVersionId as DocumentVersionId,
    anchorId: row.anchorId as AnchorId | null,
    segmentId: row.segmentId as SegmentId | null,
    quotedText: row.quotedText,
    kind: row.kind,
    deadlineDate: row.deadlineDate,
    adjustedDate: row.adjustedDate,
    ruleIds: (row.ruleIds as string[]) ?? [],
    citations: (row.citations as string[]) ?? [],
    packVersion: row.packVersion,
    deliverable: row.deliverable,
    actor: row.actor,
    conditions: row.conditions,
    rrule: row.rrule ?? null,
    dateProvenance: row.dateProvenance as DateProvenance,
    status: row.status as RecordStatus,
    splitFromRecordId: row.splitFromRecordId as RegisterRecordId | null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ReviewRepository {
  // Projects
  insertProject(name: string, description: string | null): Promise<Project>;
  getProject(projectId: ProjectId): Promise<Project | null>;

  // Analyses
  insertAnalysis(
    documentVersionId: DocumentVersionId,
    configHash: string,
    stageVersions?: Record<string, string>,
  ): Promise<Analysis>;
  getAnalysis(analysisId: AnalysisId): Promise<Analysis | null>;
  getAnalysisByConfig(
    documentVersionId: DocumentVersionId,
    configHash: string,
  ): Promise<Analysis | null>;
  updateAnalysisStatus(
    analysisId: AnalysisId,
    status: AnalysisStatus,
    error?: string,
  ): Promise<void>;
  getLatestCompletedAnalysis(
    documentVersionId: DocumentVersionId,
  ): Promise<Analysis | null>;

  // Proposals
  insertProposals(proposalRows: ProposalInsert[]): Promise<void>;
  getProposalsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<ReviewProposal[]>;
  deletePendingProposalsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<number>;
  getProposal(proposalId: ProposalId): Promise<ReviewProposal | null>;
  getLatestProposalByAnchor(
    documentVersionId: DocumentVersionId,
    anchorId: AnchorId,
  ): Promise<ReviewProposal | null>;
  updateProposalStatus(
    proposalId: ProposalId,
    status: ProposalStatus,
  ): Promise<void>;
  updateProposalResolution(
    proposalId: ProposalId,
    fields: {
      status: ProposalStatus;
      resolved: boolean;
      statutoryDate: string | null;
      adjustedDate: string | null;
      citations: string[];
    },
  ): Promise<void>;

  // Review events
  insertReviewEvent(event: ReviewEventInsert): Promise<ReviewEvent>;
  getReviewEvent(eventId: ReviewEventId): Promise<ReviewEvent | null>;
  getReviewEventByIdempotencyKey(
    key: string,
  ): Promise<ReviewEvent | null>;
  getReviewEventsByProposal(
    proposalId: ProposalId,
  ): Promise<ReviewEvent[]>;

  // Register records
  insertRegisterRecord(record: RegisterRecordInsert): Promise<RegisterRecord>;
  getRegisterRecord(
    recordId: RegisterRecordId,
  ): Promise<RegisterRecord | null>;
  getRegisterRecordsByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<RegisterRecord[]>;
  getAllActiveRecords(): Promise<RegisterRecord[]>;
  getRecordsByReviewEvent(
    eventId: ReviewEventId,
  ): Promise<RegisterRecord[]>;

  getActiveRecordByAnchor(
    documentVersionId: DocumentVersionId,
    anchorId: AnchorId,
  ): Promise<RegisterRecord | null>;
  supersedeRecord(recordId: RegisterRecordId): Promise<void>;

  // Occurrences
  insertOccurrences(
    recordVersionId: string,
    occurrences: readonly Occurrence[],
  ): Promise<void>;
  getOccurrencesByRecord(
    recordVersionId: string,
  ): Promise<Occurrence[]>;

  // Force-reparse support
  getAcceptedRecordCountByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<number>;
  deleteAllReviewDataByVersion(
    documentVersionId: DocumentVersionId,
  ): Promise<{ deletedAnalyses: number; deletedProposals: number; deletedRecords: number }>;

  // Provenance helpers
  getEvaluatorPromptHash(
    documentVersionId: DocumentVersionId,
  ): Promise<string | null>;

  // Idempotency
  getIdempotencyResponse(
    key: string,
  ): Promise<{ status: number; body: unknown } | null>;
  setIdempotencyResponse(
    key: string,
    endpoint: string,
    status: number,
    body: unknown,
  ): Promise<void>;
}

export interface ProposalInsert {
  readonly analysisId: string;
  readonly documentVersionId: string;
  readonly anchorId: string;
  readonly segmentId: string;
  readonly quotedText: string;
  readonly kind: string;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
  readonly originalStart: number;
  readonly originalEnd: number;
  readonly anchoringMethod: string;
  readonly parsedExpression: Record<string, unknown> | null;
  readonly resolved: boolean;
  readonly statutoryDate: string | null;
  readonly adjustedDate: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly rrule: string | null;
  readonly packVersion: string | null;
  readonly actor: string | null;
  readonly actorQuotedText: string | null;
  readonly dependsOnDescription: string | null;
  readonly supportLevel: string;
  readonly lane: string;
  readonly laneReasons: unknown;
}

export interface ReviewEventInsert {
  readonly proposalId: string | null;
  readonly action: string;
  readonly reviewerId: string;
  readonly beforeValues: Record<string, unknown> | null;
  readonly afterValues: Record<string, unknown>;
  readonly diff: readonly ReviewDiff[];
  readonly idempotencyKey: string;
}

export interface RegisterRecordInsert {
  readonly recordVersionId: string;
  readonly proposalId: string | null;
  readonly reviewEventId: string;
  readonly documentVersionId: string;
  readonly anchorId: string | null;
  readonly segmentId: string | null;
  readonly quotedText: string | null;
  readonly kind: string;
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string | null;
  readonly rrule: string | null;
  readonly deliverable: string | null;
  readonly actor: string | null;
  readonly conditions: string | null;
  readonly dateProvenance: string;
  readonly splitFromRecordId: string | null;
}

export function createReviewRepository(
  db: NodePgDatabase,
): ReviewRepository {
  return {
    async insertProject(
      name: string,
      description: string | null,
    ): Promise<Project> {
      const rows = await db
        .insert(projects)
        .values({ name, description })
        .returning();
      return rowToProject(rows[0]!);
    },

    async getProject(projectId: ProjectId): Promise<Project | null> {
      const rows = await db
        .select()
        .from(projects)
        .where(eq(projects.projectId, projectId))
        .limit(1);
      return rows.length > 0 ? rowToProject(rows[0]!) : null;
    },

    async insertAnalysis(
      documentVersionId: DocumentVersionId,
      configHash: string,
      stageVersions?: Record<string, string>,
    ): Promise<Analysis> {
      const rows = await db
        .insert(analyses)
        .values({
          documentVersionId,
          configHash,
          stageVersions: stageVersions as Record<string, unknown>,
          status: "running",
        })
        .returning();
      return rowToAnalysis(rows[0]!);
    },

    async getAnalysis(analysisId: AnalysisId): Promise<Analysis | null> {
      const rows = await db
        .select()
        .from(analyses)
        .where(eq(analyses.analysisId, analysisId))
        .limit(1);
      return rows.length > 0 ? rowToAnalysis(rows[0]!) : null;
    },

    async getAnalysisByConfig(
      documentVersionId: DocumentVersionId,
      configHash: string,
    ): Promise<Analysis | null> {
      const rows = await db
        .select()
        .from(analyses)
        .where(
          and(
            eq(analyses.documentVersionId, documentVersionId),
            eq(analyses.configHash, configHash),
          ),
        )
        .limit(1);
      return rows.length > 0 ? rowToAnalysis(rows[0]!) : null;
    },

    async updateAnalysisStatus(
      analysisId: AnalysisId,
      status: AnalysisStatus,
      error?: string,
    ): Promise<void> {
      const updates: Record<string, unknown> = { status };
      if (status === "completed" || status === "failed") {
        updates.completedAt = new Date();
      }
      if (error !== undefined) {
        updates.error = error;
      }
      await db
        .update(analyses)
        .set(updates)
        .where(eq(analyses.analysisId, analysisId));
    },

    async getLatestCompletedAnalysis(
      documentVersionId: DocumentVersionId,
    ): Promise<Analysis | null> {
      const rows = await db
        .select()
        .from(analyses)
        .where(
          and(
            eq(analyses.documentVersionId, documentVersionId),
            eq(analyses.status, "completed"),
          ),
        )
        .orderBy(desc(analyses.startedAt))
        .limit(1);
      return rows.length > 0 ? rowToAnalysis(rows[0]!) : null;
    },

    async insertProposals(proposalRows: ProposalInsert[]): Promise<void> {
      if (proposalRows.length === 0) return;
      await db.insert(proposals).values(
        proposalRows.map((p) => ({
          analysisId: p.analysisId,
          documentVersionId: p.documentVersionId,
          anchorId: p.anchorId,
          segmentId: p.segmentId,
          quotedText: p.quotedText,
          kind: p.kind,
          normalizedStart: p.normalizedStart,
          normalizedEnd: p.normalizedEnd,
          originalStart: p.originalStart,
          originalEnd: p.originalEnd,
          anchoringMethod: p.anchoringMethod,
          parsedExpression: p.parsedExpression as Record<string, unknown>,
          resolved: p.resolved,
          statutoryDate: p.statutoryDate,
          adjustedDate: p.adjustedDate,
          ruleIds: p.ruleIds as unknown as Record<string, unknown>,
          citations: p.citations as unknown as Record<string, unknown>,
          rrule: p.rrule,
          packVersion: p.packVersion,
          actor: p.actor,
          actorQuotedText: p.actorQuotedText,
          dependsOnDescription: p.dependsOnDescription,
          supportLevel: p.supportLevel,
          lane: p.lane,
          laneReasons: p.laneReasons as Record<string, unknown>,
          status: "pending_review",
        })),
      );
    },

    async getProposalsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<ReviewProposal[]> {
      const rows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.documentVersionId, documentVersionId))
        .orderBy(proposals.createdAt);
      return rows.map(rowToProposal);
    },

    async deletePendingProposalsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<number> {
      const deleted = await db
        .delete(proposals)
        .where(
          and(
            eq(proposals.documentVersionId, documentVersionId),
            eq(proposals.status, "pending_review"),
          ),
        )
        .returning({ id: proposals.proposalId });
      return deleted.length;
    },

    async getProposal(
      proposalId: ProposalId,
    ): Promise<ReviewProposal | null> {
      const rows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.proposalId, proposalId))
        .limit(1);
      return rows.length > 0 ? rowToProposal(rows[0]!) : null;
    },

    async getLatestProposalByAnchor(
      documentVersionId: DocumentVersionId,
      anchorId: AnchorId,
    ): Promise<ReviewProposal | null> {
      const rows = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.documentVersionId, documentVersionId),
            eq(proposals.anchorId, anchorId as string),
          ),
        )
        .orderBy(desc(proposals.createdAt))
        .limit(1);
      return rows.length > 0 ? rowToProposal(rows[0]!) : null;
    },

    async updateProposalStatus(
      proposalId: ProposalId,
      status: ProposalStatus,
    ): Promise<void> {
      await db
        .update(proposals)
        .set({ status })
        .where(eq(proposals.proposalId, proposalId));
    },

    async updateProposalResolution(
      proposalId: ProposalId,
      fields: {
        status: ProposalStatus;
        resolved: boolean;
        statutoryDate: string | null;
        adjustedDate: string | null;
        citations: string[];
      },
    ): Promise<void> {
      await db
        .update(proposals)
        .set({
          status: fields.status,
          resolved: fields.resolved,
          statutoryDate: fields.statutoryDate,
          adjustedDate: fields.adjustedDate,
          citations: fields.citations,
        })
        .where(eq(proposals.proposalId, proposalId));
    },

    async insertReviewEvent(
      event: ReviewEventInsert,
    ): Promise<ReviewEvent> {
      const rows = await db
        .insert(reviewEvents)
        .values({
          proposalId: event.proposalId,
          action: event.action,
          reviewerId: event.reviewerId,
          beforeValues: event.beforeValues as Record<string, unknown>,
          afterValues: event.afterValues,
          diff: event.diff as unknown as Record<string, unknown>,
          idempotencyKey: event.idempotencyKey,
        })
        .returning();
      return rowToReviewEvent(rows[0]!);
    },

    async getReviewEvent(
      eventId: ReviewEventId,
    ): Promise<ReviewEvent | null> {
      const rows = await db
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.eventId, eventId))
        .limit(1);
      return rows.length > 0 ? rowToReviewEvent(rows[0]!) : null;
    },

    async getReviewEventByIdempotencyKey(
      key: string,
    ): Promise<ReviewEvent | null> {
      const rows = await db
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.idempotencyKey, key))
        .limit(1);
      return rows.length > 0 ? rowToReviewEvent(rows[0]!) : null;
    },

    async getReviewEventsByProposal(
      proposalId: ProposalId,
    ): Promise<ReviewEvent[]> {
      const rows = await db
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.proposalId, proposalId))
        .orderBy(reviewEvents.createdAt);
      return rows.map(rowToReviewEvent);
    },

    async insertRegisterRecord(
      record: RegisterRecordInsert,
    ): Promise<RegisterRecord> {
      const rows = await db
        .insert(registerRecords)
        .values({
          recordVersionId: record.recordVersionId,
          proposalId: record.proposalId,
          reviewEventId: record.reviewEventId,
          documentVersionId: record.documentVersionId,
          anchorId: record.anchorId,
          segmentId: record.segmentId,
          quotedText: record.quotedText,
          kind: record.kind,
          deadlineDate: record.deadlineDate,
          adjustedDate: record.adjustedDate,
          ruleIds: record.ruleIds as unknown as Record<string, unknown>,
          citations: record.citations as unknown as Record<string, unknown>,
          packVersion: record.packVersion,
          rrule: record.rrule,
          deliverable: record.deliverable,
          actor: record.actor,
          conditions: record.conditions,
          dateProvenance: record.dateProvenance,
          splitFromRecordId: record.splitFromRecordId,
        })
        .returning();
      return rowToRegisterRecord(rows[0]!);
    },

    async getRegisterRecord(
      recordId: RegisterRecordId,
    ): Promise<RegisterRecord | null> {
      const rows = await db
        .select()
        .from(registerRecords)
        .where(eq(registerRecords.recordId, recordId))
        .limit(1);
      return rows.length > 0 ? rowToRegisterRecord(rows[0]!) : null;
    },

    async getRegisterRecordsByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<RegisterRecord[]> {
      const rows = await db
        .select()
        .from(registerRecords)
        .where(eq(registerRecords.documentVersionId, documentVersionId))
        .orderBy(registerRecords.createdAt);
      return rows.map(rowToRegisterRecord);
    },

    async getAllActiveRecords(): Promise<RegisterRecord[]> {
      const rows = await db
        .select()
        .from(registerRecords)
        .where(eq(registerRecords.status, "active"))
        .orderBy(registerRecords.createdAt);
      return rows.map(rowToRegisterRecord);
    },

    async getRecordsByReviewEvent(
      eventId: ReviewEventId,
    ): Promise<RegisterRecord[]> {
      const rows = await db
        .select()
        .from(registerRecords)
        .where(eq(registerRecords.reviewEventId, eventId))
        .orderBy(registerRecords.createdAt);
      return rows.map(rowToRegisterRecord);
    },

    async getActiveRecordByAnchor(
      documentVersionId: DocumentVersionId,
      anchorId: AnchorId,
    ): Promise<RegisterRecord | null> {
      const rows = await db
        .select()
        .from(registerRecords)
        .where(
          and(
            eq(registerRecords.documentVersionId, documentVersionId),
            eq(registerRecords.anchorId, anchorId as string),
            eq(registerRecords.status, "active"),
          ),
        )
        .orderBy(desc(registerRecords.createdAt))
        .limit(1);
      if (rows.length === 0) return null;
      return rowToRegisterRecord(rows[0]!);
    },

    async supersedeRecord(recordId: RegisterRecordId): Promise<void> {
      await db
        .update(registerRecords)
        .set({ status: "superseded" })
        .where(eq(registerRecords.recordId, recordId));
    },

    async getEvaluatorPromptHash(
      documentVersionId: DocumentVersionId,
    ): Promise<string | null> {
      const rows = await db
        .select({ promptHash: evaluationResults.promptHash })
        .from(evaluationResults)
        .where(eq(evaluationResults.documentVersionId, documentVersionId))
        .limit(1);
      if (rows.length === 0) return null;
      return rows[0]!.promptHash;
    },

    async getIdempotencyResponse(
      key: string,
    ): Promise<{ status: number; body: unknown } | null> {
      const rows = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key))
        .limit(1);
      if (rows.length === 0) return null;
      return {
        status: rows[0]!.responseStatus,
        body: rows[0]!.responseBody,
      };
    },

    async setIdempotencyResponse(
      key: string,
      endpoint: string,
      status: number,
      body: unknown,
    ): Promise<void> {
      await db.insert(idempotencyKeys).values({
        key,
        endpoint,
        responseStatus: status,
        responseBody: body as Record<string, unknown>,
      });
    },

    async getAcceptedRecordCountByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<number> {
      const rows = await db
        .select({ id: registerRecords.recordId })
        .from(registerRecords)
        .where(
          and(
            eq(registerRecords.documentVersionId, documentVersionId),
            eq(registerRecords.status, "active"),
          ),
        );
      return rows.length;
    },

    async deleteAllReviewDataByVersion(
      documentVersionId: DocumentVersionId,
    ): Promise<{ deletedAnalyses: number; deletedProposals: number; deletedRecords: number }> {
      const recordRows = await db
        .select({ recordVersionId: registerRecords.recordVersionId })
        .from(registerRecords)
        .where(eq(registerRecords.documentVersionId, documentVersionId));
      if (recordRows.length > 0) {
        const rvIds = recordRows.map(r => r.recordVersionId);
        await db.delete(deadlineOccurrences).where(
          inArray(deadlineOccurrences.recordVersionId, rvIds),
        );
      }

      const deletedRecords = await db
        .delete(registerRecords)
        .where(eq(registerRecords.documentVersionId, documentVersionId))
        .returning({ id: registerRecords.recordId });

      const proposalRows = await db
        .select({ proposalId: proposals.proposalId })
        .from(proposals)
        .where(eq(proposals.documentVersionId, documentVersionId));
      if (proposalRows.length > 0) {
        const pIds = proposalRows.map(p => p.proposalId);
        await db.delete(reviewEvents).where(
          inArray(reviewEvents.proposalId, pIds),
        );
      }

      const deletedProposals = await db
        .delete(proposals)
        .where(eq(proposals.documentVersionId, documentVersionId))
        .returning({ id: proposals.proposalId });

      const deletedAnalyses = await db
        .delete(analyses)
        .where(eq(analyses.documentVersionId, documentVersionId))
        .returning({ id: analyses.analysisId });

      return {
        deletedAnalyses: deletedAnalyses.length,
        deletedProposals: deletedProposals.length,
        deletedRecords: deletedRecords.length,
      };
    },

    async insertOccurrences(
      recordVersionId: string,
      occurrences: readonly Occurrence[],
    ): Promise<void> {
      if (occurrences.length === 0) return;
      const rows = occurrences.map((occ) => ({
        occurrenceId: createHash("sha256")
          .update(`${recordVersionId}:${occ.sequenceNumber}`)
          .digest("hex")
          .slice(0, 64),
        recordVersionId,
        occurrenceDate: occ.occurrenceDate,
        adjustedDate: occ.adjustedDate,
        ruleIds: occ.ruleIds as unknown as Record<string, unknown>,
        citations: occ.citations as unknown as Record<string, unknown>,
        sequenceNumber: occ.sequenceNumber,
      }));
      await db.insert(deadlineOccurrences).values(rows);
    },

    async getOccurrencesByRecord(
      recordVersionId: string,
    ): Promise<Occurrence[]> {
      const rows = await db
        .select()
        .from(deadlineOccurrences)
        .where(eq(deadlineOccurrences.recordVersionId, recordVersionId))
        .orderBy(deadlineOccurrences.sequenceNumber);
      return rows.map((row) => ({
        occurrenceDate: row.occurrenceDate,
        adjustedDate: row.adjustedDate,
        ruleIds: (row.ruleIds as string[]) ?? [],
        citations: (row.citations as string[]) ?? [],
        sequenceNumber: row.sequenceNumber,
      }));
    },
  };
}
