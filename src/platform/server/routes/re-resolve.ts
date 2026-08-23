import type { FastifyInstance } from "fastify";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId, AnchorId } from "../../../modules/shared/types.js";
import type { IngestionRepository } from "../../../modules/ingestion/service.js";
import type { GrammarRepository } from "../../db/grammar-repository.js";
import type { ResolverRepository } from "../../db/resolver-repository.js";
import type { EvaluationRepository } from "../../db/evaluation-repository.js";
import type { RoutingRepository } from "../../db/routing-repository.js";
import type { ReviewRepository, ProposalInsert } from "../../db/review-repository.js";
import type { ConflictRepository, ConflictInsert } from "../../db/conflict-repository.js";
import type { ParsingRepository } from "../../db/parsing-repository.js";
import type { AnchoringRepository } from "../../db/anchoring-repository.js";
import type { PipelineServices } from "../../../modules/review/service.js";
import type { ProposalAnchorResult } from "../../../modules/anchoring/types.js";
import type { SpanParseResult } from "../../../modules/grammar/types.js";
import type { AnchoredResolution } from "../../../modules/resolver/types.js";
import type { LaneAssignment } from "../../../modules/routing/types.js";
import { normalizeActors } from "../../../modules/extraction/actor-normalizer.js";
import { computeConfigHash, currentStageVersions, stageVersionsToRecord } from "../../../modules/shared/engine-versions.js";
import { GRAMMAR_VERSION } from "../../../modules/grammar/service.js";
import { RESOLVER_VERSION } from "../../../modules/resolver/service.js";

export interface ReResolveDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  evaluationRepository: EvaluationRepository;
  routingRepository: RoutingRepository;
  reviewRepository: ReviewRepository;
  conflictRepository: ConflictRepository;
  pipeline: PipelineServices;
  parserVersion: string;
  logger: Logger;
}

export function registerReResolveRoutes(
  app: FastifyInstance,
  deps: ReResolveDeps,
): void {
  const {
    ingestionRepository, anchoringRepository,
    grammarRepository, resolverRepository, evaluationRepository,
    routingRepository, reviewRepository, conflictRepository,
    pipeline, parserVersion, logger,
  } = deps;

  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/re-resolve",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      const version = await ingestionRepository.getVersion(dvId);
      if (!version) {
        return reply.status(404).send({
          error: { code: "DOCUMENT_NOT_FOUND", message: `Document version ${dvId} not found` },
        });
      }

      if (version.grammarStatus !== "parsed_grammar") {
        return reply.status(400).send({
          error: {
            code: "NOT_YET_ANALYSED",
            message: "Document must be fully analysed before re-resolution",
          },
        });
      }

      const previousGrammarVersion = version.grammarVersion ?? "unknown";
      const previousResolverVersion = version.resolverVersion ?? "unknown";

      const grammarStale = previousGrammarVersion !== GRAMMAR_VERSION;
      const resolverStale = previousResolverVersion !== RESOLVER_VERSION;

      if (!grammarStale && !resolverStale) {
        return reply.status(200).send({
          documentVersionId: dvId,
          status: "up_to_date",
          message: "Grammar and resolver are already at current versions",
          conflicts: [],
          before: {},
          after: {},
        });
      }

      const activeRecords = await reviewRepository.getRegisterRecordsByVersion(dvId);
      const activeByAnchor = new Map(
        activeRecords
          .filter((r) => r.status === "active" && r.anchorId)
          .map((r) => [r.anchorId!, r]),
      );

      // Snapshot resolution state before re-resolve
      const resolutionsBefore = await resolverRepository.getResultsByVersion(dvId);
      const beforeMap = new Map(
        resolutionsBefore.map((r) => [
          r.anchorId,
          {
            resolved: r.result.resolved,
            statutoryDate: r.result.resolved && "statutoryDate" in r.result ? r.result.statutoryDate : null,
            adjustedDate: r.result.resolved && "adjustedDate" in r.result ? r.result.adjustedDate : null,
          },
        ]),
      );

      // Re-run grammar (version-aware: only re-parses if stale)
      await pipeline.parseGrammar(dvId);

      // Re-run resolution (always re-resolves, deletes old results first)
      await pipeline.resolve(dvId);

      // Re-run evaluation and routing (depend on grammar/resolution)
      await pipeline.evaluate(dvId);
      await pipeline.route(dvId);

      // Snapshot resolution state after re-resolve
      const resolutionsAfter = await resolverRepository.getResultsByVersion(dvId);
      const afterMap = new Map(
        resolutionsAfter.map((r) => [
          r.anchorId,
          {
            resolved: r.result.resolved,
            statutoryDate: r.result.resolved && "statutoryDate" in r.result ? r.result.statutoryDate : null,
            adjustedDate: r.result.resolved && "adjustedDate" in r.result ? r.result.adjustedDate : null,
          },
        ]),
      );

      // Detect conflicts with accepted records (INV-9)
      await conflictRepository.deleteConflictsByVersion(dvId);
      const conflicts: ConflictInsert[] = [];

      for (const [anchorId, record] of activeByAnchor) {
        const after = afterMap.get(anchorId as AnchorId);
        if (!after) continue;

        const dateChanged =
          record.deadlineDate !== (after.statutoryDate ?? null) ||
          record.adjustedDate !== (after.adjustedDate ?? null) ||
          !after.resolved;

        if (dateChanged) {
          conflicts.push({
            documentVersionId: dvId,
            anchorId: anchorId as string,
            recordId: record.recordId,
            previousStatutoryDate: record.deadlineDate,
            previousAdjustedDate: record.adjustedDate,
            newStatutoryDate: after.statutoryDate,
            newAdjustedDate: after.adjustedDate,
            newResolved: after.resolved,
            previousGrammarVersion: previousGrammarVersion,
            newGrammarVersion: GRAMMAR_VERSION,
            previousResolverVersion: previousResolverVersion,
            newResolverVersion: RESOLVER_VERSION,
          });
        }
      }

      const insertedConflicts = [];
      for (const c of conflicts) {
        const inserted = await conflictRepository.insertConflict(c);
        insertedConflicts.push(inserted);
      }

      // Create new analysis and derive proposals
      const versions = currentStageVersions({ parserVersion });
      const configHash = computeConfigHash(versions);

      const existingAnalysis = await reviewRepository.getAnalysisByConfig(dvId, configHash);
      let analysisId: string;
      if (existingAnalysis) {
        analysisId = existingAnalysis.analysisId;
        if (existingAnalysis.status !== "completed") {
          await reviewRepository.updateAnalysisStatus(existingAnalysis.analysisId, "running");
        }
      } else {
        const analysis = await reviewRepository.insertAnalysis(dvId, configHash, stageVersionsToRecord(versions));
        analysisId = analysis.analysisId;
      }

      // Delete pending proposals and re-derive
      await reviewRepository.deletePendingProposalsByVersion(dvId);
      await deriveProposals(analysisId, dvId);
      await reviewRepository.updateAnalysisStatus(analysisId as import("../../../modules/shared/types.js").AnalysisId, "completed");

      // Compute before/after counts
      const resolvedBefore = [...beforeMap.values()].filter((r) => r.resolved).length;
      const unresolvedBefore = [...beforeMap.values()].filter((r) => !r.resolved).length;
      const resolvedAfter = [...afterMap.values()].filter((r) => r.resolved).length;
      const unresolvedAfter = [...afterMap.values()].filter((r) => !r.resolved).length;

      logger.info({
        dvId,
        previousGrammarVersion,
        previousResolverVersion,
        newGrammarVersion: GRAMMAR_VERSION,
        newResolverVersion: RESOLVER_VERSION,
        conflictCount: insertedConflicts.length,
        resolvedBefore,
        resolvedAfter,
      }, "re-resolution completed");

      return reply.status(200).send({
        documentVersionId: dvId,
        status: "re_resolved",
        previousVersions: {
          grammar: previousGrammarVersion,
          resolver: previousResolverVersion,
        },
        currentVersions: {
          grammar: GRAMMAR_VERSION,
          resolver: RESOLVER_VERSION,
        },
        before: { resolved: resolvedBefore, unresolved: unresolvedBefore },
        after: { resolved: resolvedAfter, unresolved: unresolvedAfter },
        conflicts: insertedConflicts,
      });
    },
  );

  app.post(
    "/api/v1/admin/re-resolve-all",
    async (_req, reply) => {
      const allVersions = await ingestionRepository.listAnalysedVersions();

      const staleVersions = allVersions.filter((v) => {
        const gStale = v.grammarVersion !== null && v.grammarVersion !== GRAMMAR_VERSION;
        const rStale = v.resolverVersion !== null && v.resolverVersion !== RESOLVER_VERSION;
        return gStale || rStale;
      });

      if (staleVersions.length === 0) {
        return reply.status(200).send({
          status: "up_to_date",
          message: "All documents are at current grammar/resolver versions",
          documents: [],
        });
      }

      const results: Array<{
        documentVersionId: string;
        legalIdentity: unknown;
        before: { resolved: number; unresolved: number };
        after: { resolved: number; unresolved: number };
        conflicts: number;
      }> = [];

      for (const v of staleVersions) {
        const dvId = v.documentVersionId;

        const previousGrammarVersion = v.grammarVersion ?? "unknown";
        const previousResolverVersion = v.resolverVersion ?? "unknown";

        const resolutionsBefore = await resolverRepository.getResultsByVersion(dvId);
        const resolvedBefore = resolutionsBefore.filter((r) => r.result.resolved).length;
        const unresolvedBefore = resolutionsBefore.filter((r) => !r.result.resolved).length;

        const activeRecords = await reviewRepository.getRegisterRecordsByVersion(dvId);
        const activeByAnchor = new Map(
          activeRecords
            .filter((r) => r.status === "active" && r.anchorId)
            .map((r) => [r.anchorId!, r]),
        );

        await pipeline.parseGrammar(dvId);
        await pipeline.resolve(dvId);
        await pipeline.evaluate(dvId);
        await pipeline.route(dvId);

        const resolutionsAfter = await resolverRepository.getResultsByVersion(dvId);
        const resolvedAfter = resolutionsAfter.filter((r) => r.result.resolved).length;
        const unresolvedAfter = resolutionsAfter.filter((r) => !r.result.resolved).length;

        // Detect conflicts
        await conflictRepository.deleteConflictsByVersion(dvId);
        let conflictCount = 0;

        for (const [anchorId, record] of activeByAnchor) {
          const after = resolutionsAfter.find((r) => r.anchorId === anchorId);
          if (!after) continue;

          const newStatutory = after.result.resolved && "statutoryDate" in after.result ? after.result.statutoryDate : null;
          const newAdjusted = after.result.resolved && "adjustedDate" in after.result ? after.result.adjustedDate : null;

          const dateChanged =
            record.deadlineDate !== newStatutory ||
            record.adjustedDate !== newAdjusted ||
            !after.result.resolved;

          if (dateChanged) {
            await conflictRepository.insertConflict({
              documentVersionId: dvId,
              anchorId: anchorId as string,
              recordId: record.recordId,
              previousStatutoryDate: record.deadlineDate,
              previousAdjustedDate: record.adjustedDate,
              newStatutoryDate: newStatutory,
              newAdjustedDate: newAdjusted,
              newResolved: after.result.resolved,
              previousGrammarVersion,
              newGrammarVersion: GRAMMAR_VERSION,
              previousResolverVersion,
              newResolverVersion: RESOLVER_VERSION,
            });
            conflictCount++;
          }
        }

        // Create analysis and proposals
        const versions = currentStageVersions({ parserVersion });
        const configHash = computeConfigHash(versions);
        const existingAnalysis = await reviewRepository.getAnalysisByConfig(dvId, configHash);
        let analysisId: string;
        if (existingAnalysis) {
          analysisId = existingAnalysis.analysisId;
        } else {
          const analysis = await reviewRepository.insertAnalysis(dvId, configHash, stageVersionsToRecord(versions));
          analysisId = analysis.analysisId;
        }
        await reviewRepository.deletePendingProposalsByVersion(dvId);
        await deriveProposals(analysisId, dvId);
        await reviewRepository.updateAnalysisStatus(analysisId as import("../../../modules/shared/types.js").AnalysisId, "completed");

        results.push({
          documentVersionId: dvId,
          legalIdentity: v.legalIdentity,
          before: { resolved: resolvedBefore, unresolved: unresolvedBefore },
          after: { resolved: resolvedAfter, unresolved: unresolvedAfter },
          conflicts: conflictCount,
        });

        logger.info({
          dvId,
          resolvedBefore,
          resolvedAfter,
          conflictCount,
        }, "backfill re-resolved document");
      }

      const totalConflicts = results.reduce((sum, r) => sum + r.conflicts, 0);

      logger.info({
        documentsProcessed: results.length,
        totalConflicts,
      }, "backfill re-resolution complete");

      return reply.status(200).send({
        status: "completed",
        documentsProcessed: results.length,
        totalConflicts,
        documents: results,
      });
    },
  );

  async function deriveProposals(
    analysisId: string,
    dvId: DocumentVersionId,
  ): Promise<void> {
    const [anchorResults, evaluations, grammarResults, resolutionResults, assignments] =
      await Promise.all([
        anchoringRepository.getResultsByVersion(dvId),
        evaluationRepository.getResultsByVersion(dvId),
        grammarRepository.getResultsByVersion(dvId),
        resolverRepository.getResultsByVersion(dvId),
        routingRepository.getAssignmentsByVersion(dvId),
      ]);

    const anchorMap = new Map(anchorResults.map((a) => [a.anchorId, a] as [string, ProposalAnchorResult]));
    const grammarMap = new Map(grammarResults.map((g) => [g.anchorId, g] as [string, SpanParseResult]));
    const resolutionMap = new Map(resolutionResults.map((r) => [r.anchorId, r] as [string, AnchoredResolution]));
    const assignmentMap = new Map(assignments.map((a) => [a.anchorId, a] as [string, LaneAssignment]));

    const proposalRows: ProposalInsert[] = [];

    for (const evaluation of evaluations) {
      const anchor = anchorMap.get(evaluation.anchorId as string);
      if (!anchor || !anchor.result.anchored) continue;

      const grammar = grammarMap.get(evaluation.anchorId as string);
      const resolution = resolutionMap.get(evaluation.anchorId as string);
      const assignment = assignmentMap.get(evaluation.anchorId as string);
      const anchoredResult = anchor.result;

      proposalRows.push({
        analysisId,
        documentVersionId: dvId as string,
        anchorId: anchor.anchorId as string,
        segmentId: anchor.segmentId as string,
        quotedText: anchor.quotedText,
        kind: anchor.kind,
        normalizedStart: anchoredResult.normalizedStart,
        normalizedEnd: anchoredResult.normalizedEnd,
        originalStart: anchoredResult.originalStart,
        originalEnd: anchoredResult.originalEnd,
        anchoringMethod: anchoredResult.method,
        parsedExpression: grammar?.result.parsed
          ? (grammar.result.expression as unknown as Record<string, unknown>)
          : null,
        resolved: resolution?.result.resolved ?? false,
        statutoryDate: resolution?.result.resolved && "statutoryDate" in resolution.result ? resolution.result.statutoryDate : null,
        adjustedDate: resolution?.result.resolved && "adjustedDate" in resolution.result ? resolution.result.adjustedDate : null,
        rrule: resolution?.result.resolved && "rrule" in resolution.result ? resolution.result.rrule : null,
        ruleIds: resolution?.result.resolved ? (resolution.result.ruleIds as string[]) : [],
        citations: resolution?.result.resolved ? (resolution.result.citations as string[]) : [],
        packVersion: resolution?.result.resolved ? resolution.result.packVersion : null,
        actor: anchor.actorQuotedText ?? null,
        actorQuotedText: anchor.actorQuotedText ?? null,
        dependsOnDescription: anchor.dependsOnAnchored ? anchor.dependsOnDescription : null,
        supportLevel: evaluation.supportLevel,
        lane: assignment?.lane ?? "blocked",
        laneReasons: assignment?.reasons ?? [],
      });
    }

    if (proposalRows.length > 0) {
      const actorMap = normalizeActors(proposalRows.map((p) => p.actor));
      if (actorMap.size > 0) {
        for (let i = 0; i < proposalRows.length; i++) {
          const raw = proposalRows[i]!.actor;
          if (raw && actorMap.has(raw)) {
            proposalRows[i] = { ...proposalRows[i]!, actor: actorMap.get(raw)! };
          }
        }
      }
      await reviewRepository.insertProposals(proposalRows);
    }

    logger.info({ analysisId, dvId, proposalCount: proposalRows.length }, "re-resolve proposals derived");
  }
}
