import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { EvaluationRepository } from "../../platform/db/evaluation-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, AnchorId, SegmentId, SupportLevel } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { runDeterministicChecks } from "./deterministic-checks.js";
import type { DeterministicCheckInput } from "./deterministic-checks.js";
import type { SupportEvaluator } from "./evaluator.js";
import type { SpanEvaluation, DocumentEvaluationResult } from "./types.js";
import { EVALUATOR_VERSION } from "./types.js";

export { EVALUATOR_VERSION };

export interface EvaluationServiceDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  evaluationRepository: EvaluationRepository;
  evaluator: SupportEvaluator;
  logger: Logger;
}

export function createEvaluationService(deps: EvaluationServiceDeps) {
  const {
    ingestionRepository,
    parsingRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    evaluator,
    logger,
  } = deps;

  return {
    async evaluateDocument(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentEvaluationResult> {
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

      if (version.resolutionStatus !== "resolved_resolver") {
        throw new AppError({
          code: "DOCUMENT_NOT_RESOLVED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been resolved yet (status: ${version.resolutionStatus})`,
          retryable: false,
          context: { documentVersionId, resolutionStatus: version.resolutionStatus },
        });
      }

      if (version.evaluationStatus === "evaluated") {
        await evaluationRepository.deleteResultsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "clearing previous evaluation results before re-evaluating",
        );
      }

      const [anchorResults, segments, grammarResults, resolutionResults] =
        await Promise.all([
          anchoringRepository.getResultsByVersion(documentVersionId),
          parsingRepository.getSegmentsByVersion(documentVersionId),
          grammarRepository.getResultsByVersion(documentVersionId),
          resolverRepository.getResultsByVersion(documentVersionId),
        ]);

      const segmentMap = new Map(
        segments.map((s) => [s.segmentId, s]),
      );
      const grammarMap = new Map(
        grammarResults.map((g) => [g.anchorId, g]),
      );
      const resolutionMap = new Map(
        resolutionResults.map((r) => [r.anchorId, r]),
      );

      const anchoredResults = anchorResults.filter((r) => r.result.anchored);
      const evaluations: SpanEvaluation[] = [];

      for (const anchor of anchoredResults) {
        const checkInput: DeterministicCheckInput = {
          anchorId: anchor.anchorId as AnchorId,
          segmentId: anchor.segmentId as SegmentId,
          documentVersionId,
          anchorResult: anchor,
          segment: segmentMap.get(anchor.segmentId as SegmentId),
          grammarResult: grammarMap.get(anchor.anchorId),
          resolutionResult: resolutionMap.get(anchor.anchorId),
        };

        const deterministicResult = runDeterministicChecks(checkInput);

        if (!deterministicResult.allPassed) {
          evaluations.push({
            anchorId: anchor.anchorId as AnchorId,
            segmentId: anchor.segmentId as SegmentId,
            quotedText: anchor.quotedText,
            deterministicResult,
            evaluatorVerdict: null,
            supportLevel: "unsupported" as SupportLevel,
          });
          continue;
        }

        const segment = segmentMap.get(anchor.segmentId as SegmentId);
        const evalResult = await evaluator.evaluate({
          anchorId: anchor.anchorId as AnchorId,
          segmentId: anchor.segmentId as SegmentId,
          kind: anchor.kind,
          quotedText: anchor.quotedText,
          segmentText: segment?.normalizedText ?? "",
        });

        // INV-4: "supported" comes from deterministic checks passing, not from
        // the evaluator. The evaluator may only downgrade.
        let supportLevel: SupportLevel = "supported";
        if (evalResult.verdict === "unsupported") {
          supportLevel = "unsupported";
        } else if (evalResult.verdict === "ambiguous") {
          supportLevel = "ambiguous";
        }

        evaluations.push({
          anchorId: anchor.anchorId as AnchorId,
          segmentId: anchor.segmentId as SegmentId,
          quotedText: anchor.quotedText,
          deterministicResult,
          evaluatorVerdict: evalResult.verdict,
          supportLevel,
        });
      }

      const allSupported = evaluations.length > 0 && evaluations.every(
        (e) => e.supportLevel === "supported",
      );
      const approved = allSupported;

      await evaluationRepository.insertResults(
        documentVersionId,
        evaluations,
        EVALUATOR_VERSION,
        evaluator.promptHash,
      );
      await evaluationRepository.updateEvaluationStatus(
        documentVersionId,
        "evaluated",
        EVALUATOR_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalEvaluated: evaluations.length,
          totalSupported: evaluations.filter((e) => e.supportLevel === "supported").length,
          totalAmbiguous: evaluations.filter((e) => e.supportLevel === "ambiguous").length,
          totalUnsupported: evaluations.filter((e) => e.supportLevel === "unsupported").length,
          approved,
        },
        "evaluation complete",
      );

      return {
        documentVersionId,
        evaluatorVersion: EVALUATOR_VERSION,
        promptHash: evaluator.promptHash,
        evaluations,
        approved,
        totalEvaluated: evaluations.length,
        totalSupported: evaluations.filter((e) => e.supportLevel === "supported").length,
        totalAmbiguous: evaluations.filter((e) => e.supportLevel === "ambiguous").length,
        totalUnsupported: evaluations.filter((e) => e.supportLevel === "unsupported").length,
      };
    },
  };
}
