import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, AnchorId, SegmentId } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { parseTemporalExpression, GRAMMAR_VERSION } from "./parse.js";
import { createAnchoredSpan } from "./types.js";
import type { SpanParseResult } from "./types.js";

export { GRAMMAR_VERSION };

export interface GrammarServiceDeps {
  ingestionRepository: IngestionRepository;
  anchoringRepository: AnchoringRepository;
  grammarRepository: GrammarRepository;
  logger: Logger;
}

export interface DocumentGrammarResult {
  readonly documentVersionId: DocumentVersionId;
  readonly grammarVersion: string;
  readonly results: readonly SpanParseResult[];
  readonly totalSpans: number;
  readonly totalParsed: number;
  readonly totalFailed: number;
}

export function createGrammarService(deps: GrammarServiceDeps) {
  const {
    ingestionRepository,
    anchoringRepository,
    grammarRepository,
    logger,
  } = deps;

  return {
    async parseDocument(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentGrammarResult> {
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

      if (version.anchoringStatus !== "anchored") {
        throw new AppError({
          code: "DOCUMENT_NOT_ANCHORED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been anchored yet (status: ${version.anchoringStatus})`,
          retryable: false,
          context: { documentVersionId, anchoringStatus: version.anchoringStatus },
        });
      }

      if (
        version.grammarStatus === "parsed_grammar" &&
        version.grammarVersion === GRAMMAR_VERSION
      ) {
        const existing =
          await grammarRepository.getResultsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "grammar already parsed, returning existing results",
        );
        return buildResult(documentVersionId, existing);
      }

      if (
        version.grammarStatus === "parsed_grammar" &&
        version.grammarVersion !== GRAMMAR_VERSION
      ) {
        logger.info(
          {
            documentVersionId,
            storedVersion: version.grammarVersion,
            currentVersion: GRAMMAR_VERSION,
          },
          "grammar version changed, re-parsing",
        );
        await grammarRepository.deleteResultsByVersion(documentVersionId);
      }

      const anchorResults =
        await anchoringRepository.getResultsByVersion(documentVersionId);

      const anchoredOnly = anchorResults.filter((r) => r.result.anchored);

      const parseResults: SpanParseResult[] = [];
      for (const ar of anchoredOnly) {
        const span = createAnchoredSpan(
          ar.anchorId as AnchorId,
          ar.segmentId as SegmentId,
          ar.quotedText,
        );
        const result = parseTemporalExpression(span);
        parseResults.push(result);
      }

      await grammarRepository.insertResults(
        documentVersionId,
        parseResults,
        GRAMMAR_VERSION,
      );
      await grammarRepository.updateGrammarStatus(
        documentVersionId,
        "parsed_grammar",
        GRAMMAR_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalSpans: parseResults.length,
          totalParsed: parseResults.filter((r) => r.result.parsed).length,
          totalFailed: parseResults.filter((r) => !r.result.parsed).length,
        },
        "grammar parsing complete",
      );

      return buildResult(documentVersionId, parseResults);
    },
  };
}

function buildResult(
  documentVersionId: DocumentVersionId,
  results: readonly SpanParseResult[],
): DocumentGrammarResult {
  return {
    documentVersionId,
    grammarVersion: GRAMMAR_VERSION,
    results,
    totalSpans: results.length,
    totalParsed: results.filter((r) => r.result.parsed).length,
    totalFailed: results.filter((r) => !r.result.parsed).length,
  };
}
