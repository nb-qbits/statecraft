import type { GrammarRepository } from "../../platform/db/grammar-repository.js";
import type { ResolverRepository } from "../../platform/db/resolver-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { resolve, RESOLVER_VERSION } from "./resolve.js";
import { loadPack } from "../jurisdiction/pack-loader.js";
import type {
  AnchoredResolution,
  ParsedAnchoredExpression,
  ResolutionInput,
} from "./types.js";
import type { TemporalExpression } from "../grammar/types.js";

export { RESOLVER_VERSION };

export interface ResolverServiceDeps {
  ingestionRepository: IngestionRepository;
  grammarRepository: GrammarRepository;
  resolverRepository: ResolverRepository;
  logger: Logger;
}

export interface DocumentResolutionResult {
  readonly documentVersionId: DocumentVersionId;
  readonly resolverVersion: string;
  readonly results: readonly AnchoredResolution[];
  readonly totalExpressions: number;
  readonly totalResolved: number;
  readonly totalUnresolved: number;
}

export function createResolverService(deps: ResolverServiceDeps) {
  const {
    ingestionRepository,
    grammarRepository,
    resolverRepository,
    logger,
  } = deps;

  return {
    async resolveDocument(
      documentVersionId: DocumentVersionId,
      suppliedInputs: readonly ResolutionInput[] = [],
    ): Promise<DocumentResolutionResult> {
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

      if (version.grammarStatus !== "parsed_grammar") {
        throw new AppError({
          code: "DOCUMENT_NOT_PARSED_GRAMMAR",
          category: "user_input",
          message: `Document version ${documentVersionId} has not had grammar parsed yet (status: ${version.grammarStatus})`,
          retryable: false,
          context: { documentVersionId, grammarStatus: version.grammarStatus },
        });
      }

      if (version.resolutionStatus === "resolved_resolver") {
        await resolverRepository.deleteResultsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "clearing previous resolution results before re-resolving",
        );
      }

      const grammarResults =
        await grammarRepository.getResultsByVersion(documentVersionId);

      const parsedOnly = grammarResults.filter((r) => r.result.parsed);

      const jurisdiction = version.legalIdentity.jurisdiction;
      const pack = await loadPack(jurisdiction, "1");

      const resolutions: AnchoredResolution[] = [];
      for (const gr of parsedOnly) {
        if (!gr.result.parsed) continue;
        const expression = gr.result.expression as TemporalExpression;

        const pae: ParsedAnchoredExpression = {
          anchorId: gr.anchorId,
          segmentId: gr.segmentId,
          text: gr.text,
          expression,
        };

        const result = resolve(pae, suppliedInputs, pack);

        resolutions.push({
          anchorId: gr.anchorId,
          segmentId: gr.segmentId,
          text: gr.text,
          expression,
          result,
        });
      }

      await resolverRepository.insertResults(
        documentVersionId,
        resolutions,
        RESOLVER_VERSION,
      );
      await resolverRepository.updateResolutionStatus(
        documentVersionId,
        "resolved_resolver",
        RESOLVER_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalExpressions: resolutions.length,
          totalResolved: resolutions.filter((r) => r.result.resolved).length,
          totalUnresolved: resolutions.filter((r) => !r.result.resolved).length,
        },
        "resolution complete",
      );

      return buildResult(documentVersionId, resolutions);
    },
  };
}

function buildResult(
  documentVersionId: DocumentVersionId,
  results: readonly AnchoredResolution[],
): DocumentResolutionResult {
  return {
    documentVersionId,
    resolverVersion: RESOLVER_VERSION,
    results,
    totalExpressions: results.length,
    totalResolved: results.filter((r) => r.result.resolved).length,
    totalUnresolved: results.filter((r) => !r.result.resolved).length,
  };
}
