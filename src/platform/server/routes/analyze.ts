import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import type { Logger } from "../../logger/logger.js";
import type {
  DocumentVersionId,
  AnalysisId,
} from "../../../modules/shared/types.js";
import type { IngestionRepository } from "../../../modules/ingestion/service.js";
import type { ParsingRepository } from "../../db/parsing-repository.js";
import type { ScanningRepository } from "../../db/scanning-repository.js";
import type { AnchoringRepository } from "../../db/anchoring-repository.js";
import type { GrammarRepository } from "../../db/grammar-repository.js";
import type { ResolverRepository } from "../../db/resolver-repository.js";
import type { EvaluationRepository } from "../../db/evaluation-repository.js";
import type { RoutingRepository } from "../../db/routing-repository.js";
import type { ReviewRepository, ProposalInsert } from "../../db/review-repository.js";
import type { PipelineServices } from "../../../modules/review/service.js";

import type { ProposalAnchorResult } from "../../../modules/anchoring/types.js";
import type { SpanParseResult } from "../../../modules/grammar/types.js";
import type { AnchoredResolution } from "../../../modules/resolver/types.js";
import type { LaneAssignment } from "../../../modules/routing/types.js";

import { SCANNER_VERSION } from "../../../modules/scanning/scanner.js";
import { EXTRACTOR_VERSION } from "../../../modules/extraction/service.js";
import { ANCHORER_VERSION } from "../../../modules/anchoring/service.js";
import { GRAMMAR_VERSION } from "../../../modules/grammar/service.js";
import { RESOLVER_VERSION } from "../../../modules/resolver/service.js";
import { EVALUATOR_VERSION } from "../../../modules/evaluation/types.js";
import { ROUTER_VERSION } from "../../../modules/routing/types.js";
import { REVIEW_VERSION } from "../../../modules/review/types.js";

export interface AnalyzeDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  scanningRepository: ScanningRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  evaluationRepository: EvaluationRepository;
  routingRepository: RoutingRepository;
  reviewRepository: ReviewRepository;
  pipeline: PipelineServices;
  logger: Logger;
}

interface StageEvent {
  stage: string;
  status: "completed" | "failed";
  counts: Record<string, number>;
  error?: string;
}

function computeConfigHash(): string {
  const versions = [
    SCANNER_VERSION, EXTRACTOR_VERSION, ANCHORER_VERSION, GRAMMAR_VERSION,
    RESOLVER_VERSION, EVALUATOR_VERSION, ROUTER_VERSION, REVIEW_VERSION,
  ];
  return createHash("sha256").update(versions.join(":")).digest("hex");
}

function sseEvent(event: StageEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function registerAnalyzeRoutes(
  app: FastifyInstance,
  deps: AnalyzeDeps,
): void {
  const {
    ingestionRepository, parsingRepository, scanningRepository,
    anchoringRepository, grammarRepository, resolverRepository,
    evaluationRepository, routingRepository, reviewRepository,
    pipeline, logger,
  } = deps;

  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/analyze",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      const version = await ingestionRepository.getVersion(dvId);
      if (!version) {
        return reply.status(404).send({
          error: { code: "DOCUMENT_NOT_FOUND", message: `Document version ${dvId} not found` },
        });
      }

      const configHash = computeConfigHash();
      const existing = await reviewRepository.getAnalysisByConfig(dvId, configHash);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      if (existing && existing.status === "completed") {
        logger.info({ dvId, configHash }, "streaming cached analysis results");
        await streamCachedResults(reply.raw, dvId);
        reply.raw.end();
        return;
      }

      let analysisId: AnalysisId;
      if (existing && existing.status === "failed") {
        await reviewRepository.updateAnalysisStatus(existing.analysisId, "running");
        analysisId = existing.analysisId;
      } else if (existing) {
        analysisId = existing.analysisId;
      } else {
        const analysis = await reviewRepository.insertAnalysis(dvId, configHash);
        analysisId = analysis.analysisId;
      }

      try {
        await pipeline.parse(dvId);
        const segments = await parsingRepository.getSegmentsByVersion(dvId);
        reply.raw.write(sseEvent({
          stage: "parsed", status: "completed",
          counts: { provisions: segments.length },
        }));

        await pipeline.scan(dvId);
        const candidates = await scanningRepository.getCandidatesByVersion(dvId);
        const nonSuppressed = candidates.filter((c) => !c.suppressed);
        reply.raw.write(sseEvent({
          stage: "scanned", status: "completed",
          counts: { candidateExpressions: nonSuppressed.length, suppressed: candidates.length - nonSuppressed.length },
        }));

        await pipeline.extract(dvId);
        await pipeline.anchor(dvId);
        const anchorResults = await anchoringRepository.getResultsByVersion(dvId);
        const anchored = anchorResults.filter((a) => a.result.anchored);
        const rejected = anchorResults.filter((a) => !a.result.anchored
          && a.result.reason !== "over_extraction_substring"
          && a.result.reason !== "duplicate_span");
        const overExtractionSuppressed = anchorResults.filter((a) => !a.result.anchored && a.result.reason === "over_extraction_substring");
        const duplicateSpansSuppressed = anchorResults.filter((a) => !a.result.anchored && a.result.reason === "duplicate_span");
        reply.raw.write(sseEvent({
          stage: "proposed", status: "completed",
          counts: { spansIdentified: anchorResults.length },
        }));
        reply.raw.write(sseEvent({
          stage: "verified", status: "completed",
          counts: {
            anchoredToSource: anchored.length,
            rejected: rejected.length,
            overExtractionSuppressed: overExtractionSuppressed.length,
            duplicateSpansSuppressed: duplicateSpansSuppressed.length,
          },
        }));

        await pipeline.parseGrammar(dvId);
        const grammarResults = await grammarRepository.getResultsByVersion(dvId);
        const grammarParsed = grammarResults.filter((g) => g.result.parsed);
        reply.raw.write(sseEvent({
          stage: "parsedDates", status: "completed",
          counts: { expressionsUnderstood: grammarParsed.length, parseFailed: grammarResults.length - grammarParsed.length },
        }));

        await pipeline.resolve(dvId);
        const resolutions = await resolverRepository.getResultsByVersion(dvId);
        const resolved = resolutions.filter((r) => r.result.resolved);
        const unresolved = resolutions.filter((r) => !r.result.resolved);
        reply.raw.write(sseEvent({
          stage: "resolved", status: "completed",
          counts: { datesComputed: resolved.length, needTriggerDate: unresolved.length },
        }));

        await pipeline.evaluate(dvId);
        await pipeline.route(dvId);
        const routingResult = await routingRepository.getResultsByVersion(dvId);
        const ls = routingResult?.laneSummary ?? { straight_through: 0, quick_confirmation: 0, exception_review: 0, blocked: 0 };
        reply.raw.write(sseEvent({
          stage: "routed", status: "completed",
          counts: {
            readyToConfirm: ls.straight_through + ls.quick_confirmation,
            needReview: ls.exception_review + ls.blocked,
            ...ls,
          },
        }));

        await deriveProposalsForAnalysis(analysisId, dvId);
        await reviewRepository.updateAnalysisStatus(analysisId, "completed");

        reply.raw.write(sseEvent({ stage: "complete", status: "completed", counts: {} }));
        logger.info({ dvId, analysisId }, "analysis completed");
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        logger.error({ err, dvId }, "analysis pipeline failed");
        await reviewRepository.updateAnalysisStatus(analysisId, "failed", message);
        reply.raw.write(sseEvent({ stage: "error", status: "failed", counts: {}, error: message }));
      }

      reply.raw.end();
    },
  );

  async function streamCachedResults(
    raw: import("node:http").ServerResponse,
    dvId: DocumentVersionId,
  ): Promise<void> {
    const segments = await parsingRepository.getSegmentsByVersion(dvId);
    raw.write(sseEvent({ stage: "parsed", status: "completed", counts: { provisions: segments.length } }));

    const candidates = await scanningRepository.getCandidatesByVersion(dvId);
    const nonSuppressed = candidates.filter((c) => !c.suppressed);
    raw.write(sseEvent({
      stage: "scanned", status: "completed",
      counts: { candidateExpressions: nonSuppressed.length, suppressed: candidates.length - nonSuppressed.length },
    }));

    const anchorResults = await anchoringRepository.getResultsByVersion(dvId);
    const anchored = anchorResults.filter((a) => a.result.anchored);
    const rejected = anchorResults.filter((a) => !a.result.anchored
      && a.result.reason !== "over_extraction_substring"
      && a.result.reason !== "duplicate_span");
    const overExtractionSuppressed = anchorResults.filter((a) => !a.result.anchored && a.result.reason === "over_extraction_substring");
    const duplicateSpansSuppressed = anchorResults.filter((a) => !a.result.anchored && a.result.reason === "duplicate_span");
    raw.write(sseEvent({ stage: "proposed", status: "completed", counts: { spansIdentified: anchorResults.length } }));
    raw.write(sseEvent({
      stage: "verified", status: "completed",
      counts: {
        anchoredToSource: anchored.length,
        rejected: rejected.length,
        overExtractionSuppressed: overExtractionSuppressed.length,
        duplicateSpansSuppressed: duplicateSpansSuppressed.length,
      },
    }));

    const grammarResults = await grammarRepository.getResultsByVersion(dvId);
    const grammarParsed = grammarResults.filter((g) => g.result.parsed);
    raw.write(sseEvent({
      stage: "parsedDates", status: "completed",
      counts: { expressionsUnderstood: grammarParsed.length, parseFailed: grammarResults.length - grammarParsed.length },
    }));

    const resolutions = await resolverRepository.getResultsByVersion(dvId);
    const resolved = resolutions.filter((r) => r.result.resolved);
    const unresolved = resolutions.filter((r) => !r.result.resolved);
    raw.write(sseEvent({
      stage: "resolved", status: "completed",
      counts: { datesComputed: resolved.length, needTriggerDate: unresolved.length },
    }));

    const routingResult = await routingRepository.getResultsByVersion(dvId);
    const ls = routingResult?.laneSummary ?? { straight_through: 0, quick_confirmation: 0, exception_review: 0, blocked: 0 };
    raw.write(sseEvent({
      stage: "routed", status: "completed",
      counts: { readyToConfirm: ls.straight_through + ls.quick_confirmation, needReview: ls.exception_review + ls.blocked, ...ls },
    }));

    raw.write(sseEvent({ stage: "complete", status: "completed", counts: {} }));
  }

  async function deriveProposalsForAnalysis(
    analysisId: AnalysisId,
    dvId: DocumentVersionId,
  ): Promise<void> {
    const existingProposals = await reviewRepository.getProposalsByVersion(dvId);
    if (existingProposals.length > 0) return;

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
        analysisId: analysisId as string,
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
        statutoryDate: resolution?.result.resolved ? resolution.result.statutoryDate : null,
        adjustedDate: resolution?.result.resolved ? resolution.result.adjustedDate : null,
        ruleIds: resolution?.result.resolved ? (resolution.result.ruleIds as string[]) : [],
        citations: resolution?.result.resolved ? (resolution.result.citations as string[]) : [],
        packVersion: resolution?.result.resolved ? resolution.result.packVersion : null,
        supportLevel: evaluation.supportLevel,
        lane: assignment?.lane ?? "blocked",
        laneReasons: assignment?.reasons ?? [],
      });
    }

    if (proposalRows.length > 0) {
      await reviewRepository.insertProposals(proposalRows);
    }

    logger.info({ analysisId, dvId, proposalCount: proposalRows.length }, "proposals derived");
  }
}
