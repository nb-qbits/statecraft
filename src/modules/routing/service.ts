import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { RoutingRepository } from "../../platform/db/routing-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, Fidelity } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { assignLane } from "./lane-router.js";
import { computeProcessingCoverage } from "./coverage.js";
import { deriveCoverageState } from "../scanning/scanner.js";
import type { SegmentScanResult } from "../scanning/types.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { DocumentRoutingResult, LaneAssignment, LaneSummary } from "./types.js";
import { ROUTER_VERSION } from "./types.js";

export interface RoutingServiceDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  scanningRepository: ScanningRepository;
  evaluationRepository: EvaluationRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  routingRepository: RoutingRepository;
  logger: Logger;
}

export function createRoutingService(deps: RoutingServiceDeps) {
  const {
    ingestionRepository,
    parsingRepository,
    scanningRepository,
    evaluationRepository,
    grammarRepository,
    resolverRepository,
    routingRepository,
    logger,
  } = deps;

  return {
    async routeDocument(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentRoutingResult> {
      const version = await ingestionRepository.getVersion(documentVersionId);
      if (!version) {
        throw new AppError({
          code: "DOCUMENT_NOT_FOUND",
          category: "user_input",
          message: `Document version ${documentVersionId} not found`,
          retryable: false,
          context: { documentVersionId },
        });
      }

      if (version.evaluationStatus !== "evaluated") {
        throw new AppError({
          code: "DOCUMENT_NOT_EVALUATED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been evaluated yet (status: ${version.evaluationStatus})`,
          retryable: false,
          context: { documentVersionId, evaluationStatus: version.evaluationStatus },
        });
      }

      if (version.routingStatus === "routed" && version.routerVersion === ROUTER_VERSION) {
        const existing = await routingRepository.getResultsByVersion(documentVersionId);
        if (existing) {
          logger.info({ documentVersionId }, "already routed with current version, returning existing results");
          return existing;
        }
      }

      await routingRepository.deleteResultsByVersion(documentVersionId);
      if (version.routingStatus === "routed") {
        logger.info(
          { documentVersionId, storedVersion: version.routerVersion, currentVersion: ROUTER_VERSION },
          "re-routing",
        );
      }

      const [evaluations, grammarResults, resolutionResults, segments, candidates] =
        await Promise.all([
          evaluationRepository.getResultsByVersion(documentVersionId),
          grammarRepository.getResultsByVersion(documentVersionId),
          resolverRepository.getResultsByVersion(documentVersionId),
          parsingRepository.getSegmentsByVersion(documentVersionId),
          scanningRepository.getCandidatesByVersion(documentVersionId),
        ]);

      const grammarMap = new Map(grammarResults.map((g) => [g.anchorId, g]));
      const resolutionMap = new Map(resolutionResults.map((r) => [r.anchorId, r]));
      const segmentFidelityMap = new Map<string, Fidelity>(
        segments.map((s) => [s.segmentId, s.fidelity]),
      );

      const assignments: LaneAssignment[] = [];

      for (const evaluation of evaluations) {
        const assignment = assignLane({
          evaluation,
          grammarResult: grammarMap.get(evaluation.anchorId),
          resolutionResult: resolutionMap.get(evaluation.anchorId),
          segmentFidelity: segmentFidelityMap.get(evaluation.segmentId as string) ?? "none",
          legislativeStatus: version.legislativeStatus,
        });
        assignments.push(assignment);
      }

      // Build segment scan results for coverage from scanning data
      const segmentCandidateMap = new Map<string, typeof candidates>();
      for (const c of candidates) {
        const existing = segmentCandidateMap.get(c.segmentId as string) ?? [];
        existing.push(c);
        segmentCandidateMap.set(c.segmentId as string, existing);
      }

      const segmentScanResults: SegmentScanResult[] = segments.map((seg) => {
        const segCandidates = segmentCandidateMap.get(seg.segmentId as string) ?? [];
        return {
          segmentId: seg.segmentId,
          coverageState: deriveCoverageState(segCandidates),
          candidates: segCandidates,
        };
      });

      const coverage = computeProcessingCoverage(segmentScanResults);

      const counts = {
        straight_through: 0,
        quick_confirmation: 0,
        exception_review: 0,
        blocked: 0,
      };
      for (const a of assignments) {
        counts[a.lane]++;
      }
      const laneSummary: LaneSummary = counts;

      const result: DocumentRoutingResult = {
        documentVersionId,
        routerVersion: ROUTER_VERSION,
        assignments,
        coverage,
        laneSummary,
        totalAssignments: assignments.length,
      };

      await routingRepository.insertResults(documentVersionId, result);
      await routingRepository.updateRoutingStatus(
        documentVersionId,
        "routed",
        ROUTER_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalAssignments: assignments.length,
          laneSummary,
          coverage: {
            totalSegments: coverage.totalSegments,
            withCandidates: coverage.withCandidates,
            screenedNoCandidate: coverage.screenedNoCandidate,
            needsSweep: coverage.needsSweep,
          },
        },
        "routing complete",
      );

      return result;
    },
  };
}
