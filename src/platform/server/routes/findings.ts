import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { IngestionRepository } from "../../../modules/ingestion/service.js";
import type { ParsingRepository } from "../../db/parsing-repository.js";
import type { AnchoringRepository } from "../../db/anchoring-repository.js";
import type { GrammarRepository } from "../../db/grammar-repository.js";
import type { ResolverRepository } from "../../db/resolver-repository.js";
import type { EvaluationRepository } from "../../db/evaluation-repository.js";
import type { RoutingRepository } from "../../db/routing-repository.js";
import type { ReviewRepository } from "../../db/review-repository.js";
import { deriveProvisionLabel } from "../../../modules/shared/provision-label.js";
import { isResolvedRecurrence } from "../../../modules/resolver/types.js";
import { computeConfigHash, currentStageVersions, staleStages } from "../../../modules/shared/engine-versions.js";
import type { StageVersions } from "../../../modules/shared/engine-versions.js";

export interface FindingsDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  evaluationRepository: EvaluationRepository;
  routingRepository: RoutingRepository;
  reviewRepository: ReviewRepository;
  parserVersion: string;
  logger: Logger;
}

export function registerFindingsRoutes(
  app: FastifyInstance,
  deps: FindingsDeps,
): void {
  const {
    ingestionRepository, parsingRepository, anchoringRepository,
    grammarRepository, resolverRepository, evaluationRepository,
    routingRepository, reviewRepository, parserVersion, logger,
  } = deps;

  app.get<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/findings",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      const version = await ingestionRepository.getVersion(dvId);
      if (!version) {
        return reply.status(404).send({
          error: { code: "DOCUMENT_NOT_FOUND", message: `Document version ${dvId} not found` },
        });
      }

      try {
        const [allProposals, segments, anchorResults, grammarResults, resolutions, evaluations, routingResult] =
          await Promise.all([
            reviewRepository.getProposalsByVersion(dvId),
            parsingRepository.getSegmentsByVersion(dvId),
            anchoringRepository.getResultsByVersion(dvId),
            grammarRepository.getResultsByVersion(dvId),
            resolverRepository.getResultsByVersion(dvId),
            evaluationRepository.getResultsByVersion(dvId),
            routingRepository.getResultsByVersion(dvId),
          ]);

        const latestAnalysis = await reviewRepository.getLatestCompletedAnalysis(dvId);
        const latestAnalysisId = latestAnalysis?.analysisId ?? null;
        const proposals = (latestAnalysisId
          ? allProposals.filter((p) => p.analysisId === latestAnalysisId)
          : allProposals
        ).filter((p) => p.kind !== "effective_date");

        const current = currentStageVersions({ parserVersion });
        const currentHash = computeConfigHash(current);
        let stale: string[] = [];
        if (latestAnalysis && latestAnalysis.configHash !== currentHash) {
          const analysisVersions = latestAnalysis.stageVersions as StageVersions | null;
          stale = analysisVersions
            ? staleStages(analysisVersions, current)
            : ["unknown"];
        }

        const segmentMap = new Map(segments.map((s) => [s.segmentId, s]));
        const grammarMap = new Map(grammarResults.map((g) => [g.anchorId, g]));
        const resolutionMap = new Map(resolutions.map((r) => [r.anchorId, r]));
        const evaluationMap = new Map(evaluations.map((e) => [e.anchorId, e]));

        const findings = proposals.map((p) => {
          const segment = segmentMap.get(p.segmentId);
          const structuralPath = segment?.structuralPath ?? "";
          const provisionLabel = deriveProvisionLabel(structuralPath);

          const grammar = grammarMap.get(p.anchorId);
          const resolution = resolutionMap.get(p.anchorId);

          const grammarParsed = grammar?.result.parsed ?? false;
          const grammarFailureReason = grammar && !grammar.result.parsed
            ? grammar.result.reason
            : null;

          let unresolvedReason: string | null = null;
          let missingInputs: string[] | null = null;
          if (resolution && !resolution.result.resolved) {
            unresolvedReason = resolution.result.reason;
            missingInputs = resolution.result.missingInputs as string[];
          } else if (!resolution && grammarParsed) {
            unresolvedReason = "no resolution attempted";
            missingInputs = null;
          }

          const evalResult = evaluationMap.get(p.anchorId);
          const deterministicChecks = evalResult?.deterministicResult ?? null;

          const rrule = p.resolved ? (p.rrule ?? null) : null;
          let occurrences: Array<{
            occurrenceDate: string;
            adjustedDate: string;
            ruleIds: string[];
            citations: string[];
            sequenceNumber: number;
          }> = [];
          let horizon: string | null = null;

          if (p.resolved && rrule && resolution && isResolvedRecurrence(resolution.result)) {
            occurrences = resolution.result.occurrences.map((o) => ({
              occurrenceDate: o.occurrenceDate,
              adjustedDate: o.adjustedDate,
              ruleIds: [...o.ruleIds],
              citations: [...o.citations],
              sequenceNumber: o.sequenceNumber,
            }));
            horizon = resolution.result.horizon;
          }

          const parsedExpr = grammar?.result.parsed
            ? grammar.result.expression
            : null;

          let referenceEventText: string | null = null;
          if (parsedExpr && "referenceEventText" in parsedExpr && parsedExpr.referenceEventText) {
            referenceEventText = parsedExpr.referenceEventText as string;
          }

          return {
            anchorId: p.anchorId,
            proposalId: p.proposalId,
            segmentId: p.segmentId,
            structuralPath,
            provisionLabel,
            quotedText: p.quotedText,
            kind: p.kind,
            actor: p.actor ?? null,
            actorQuotedText: p.actorQuotedText ?? null,
            dependsOnDescription: p.dependsOnDescription ?? null,
            anchored: true,
            anchorMethod: p.anchoringMethod,
            anchorFailureReason: null,
            originalStart: p.originalStart,
            originalEnd: p.originalEnd,
            grammarParsed,
            grammarFailureReason,
            parsedExpression: parsedExpr,
            referenceEventText,
            resolved: p.resolved,
            statutoryDate: p.statutoryDate,
            adjustedDate: p.adjustedDate,
            rrule,
            occurrences,
            horizon,
            ruleIds: p.ruleIds,
            citations: p.citations,
            packVersion: p.packVersion,
            dateProvenance: p.resolved
              ? (p.packVersion?.startsWith("default/") ? "generic_default" : "computed")
              : null,
            unresolvedReason,
            missingInputs,
            lane: p.lane,
            laneReasons: p.laneReasons,
            supportLevel: p.supportLevel,
            deterministicChecks,
            status: p.status,
          };
        });

        const rejectedSpans = anchorResults
          .filter((a) => !a.result.anchored
            && a.result.reason !== "over_extraction_substring"
            && a.result.reason !== "duplicate_span")
          .map((a) => ({
            quotedText: a.quotedText,
            reason: a.result.anchored === false ? a.result.reason : "unknown",
          }));

        const anchoredBySegment = new Map<string, typeof anchorResults>();
        for (const a of anchorResults) {
          if (!a.result.anchored) continue;
          const group = anchoredBySegment.get(a.segmentId) ?? [];
          group.push(a);
          anchoredBySegment.set(a.segmentId, group);
        }

        const suppressedSpans = anchorResults
          .filter((a) => !a.result.anchored
            && (a.result.reason === "over_extraction_substring"
              || a.result.reason === "duplicate_span"))
          .map((a) => {
            let containedBy: string | null = null;
            if (!a.result.anchored && a.result.reason === "over_extraction_substring") {
              const siblings = anchoredBySegment.get(a.segmentId) ?? [];
              const container = siblings.find(
                (s) => s.quotedText.includes(a.quotedText) && s.quotedText !== a.quotedText,
              );
              if (container) containedBy = container.quotedText;
            }
            return {
              quotedText: a.quotedText,
              segmentId: a.segmentId,
              reason: (a.result as { reason: string }).reason,
              containedBy,
            };
          });

        const coverage = routingResult?.coverage ?? {
          totalSegments: segments.length,
          withCandidates: 0,
          screenedNoCandidate: 0,
          needsSweep: segments.length,
        };

        const laneSummary = routingResult?.laneSummary ?? {
          straight_through: 0,
          quick_confirmation: 0,
          exception_review: 0,
          blocked: 0,
        };

        return reply.status(200).send({
          legalIdentity: version.legalIdentity,
          findings,
          coverage: {
            totalSegments: coverage.totalSegments,
            withCandidates: coverage.withCandidates,
            screenedNoCandidate: coverage.screenedNoCandidate,
            needsSweep: coverage.needsSweep,
          },
          laneSummary,
          rejectedSpans,
          suppressedSpans,
          engineVersions: {
            current,
            staleStages: stale,
          },
        });
      } catch (err) {
        if (err instanceof AppError) {
          logger.warn({ err: err.toJSON() }, "findings fetch failed");
          return reply.status(err.category === "user_input" ? 400 : 500).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected findings error");
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
        });
      }
    },
  );
}
