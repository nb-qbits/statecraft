import { createHash } from "node:crypto";
import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type { AnchoringRepository } from "../../platform/db/anchoring-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, AnchorId, SegmentId } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { anchorQuote, ANCHORER_VERSION } from "./anchor.js";
import { validateAndRepairResponse } from "../extraction/response-validator.js";
import type { SpanProposal } from "../extraction/types.js";
import type { DocumentAnchoringResult, ProposalAnchorResult } from "./types.js";

export { ANCHORER_VERSION };

export interface AnchoringServiceDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  extractionRepository: ExtractionRepository;
  anchoringRepository: AnchoringRepository;
  logger: Logger;
}

export function computeAnchorId(
  segmentId: string,
  quotedText: string,
  kind: string,
): AnchorId {
  const input = `${segmentId}:${quotedText}:${kind}`;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `anc_${hash}` as AnchorId;
}

export function createAnchoringService(deps: AnchoringServiceDeps) {
  const {
    ingestionRepository,
    parsingRepository,
    extractionRepository,
    anchoringRepository,
    logger,
  } = deps;

  return {
    async anchorDocument(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentAnchoringResult> {
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

      if (version.extractionStatus !== "extracted") {
        throw new AppError({
          code: "DOCUMENT_NOT_EXTRACTED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been extracted yet (status: ${version.extractionStatus})`,
          retryable: false,
          context: { documentVersionId, extractionStatus: version.extractionStatus },
        });
      }

      if (
        version.anchoringStatus === "anchored" &&
        version.anchorerVersion === ANCHORER_VERSION
      ) {
        const existing =
          await anchoringRepository.getResultsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "already anchored, returning existing results",
        );
        return buildResult(documentVersionId, existing);
      }

      if (
        version.anchoringStatus === "anchored" &&
        version.anchorerVersion !== ANCHORER_VERSION
      ) {
        logger.info(
          {
            documentVersionId,
            storedVersion: version.anchorerVersion,
            currentVersion: ANCHORER_VERSION,
          },
          "anchorer version changed, re-anchoring",
        );
        await anchoringRepository.deleteResultsByVersion(documentVersionId);
      }

      const segments =
        await parsingRepository.getSegmentsByVersion(documentVersionId);
      const segmentMap = new Map(
        segments.map((s) => [s.segmentId, s]),
      );

      const modelCalls =
        await extractionRepository.getCallsByVersion(documentVersionId);

      const proposals: SpanProposal[] = [];
      for (const call of modelCalls) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(call.responsePayload);
        } catch {
          continue;
        }

        const validation = validateAndRepairResponse(
          parsed,
          call.segmentId as SegmentId,
        );
        if (!validation.valid) continue;

        for (const p of validation.proposals) {
          proposals.push(p);
        }
      }

      const results: ProposalAnchorResult[] = [];

      for (const proposal of proposals) {
        const segment = segmentMap.get(proposal.segmentId);
        if (!segment) {
          results.push({
            anchorId: computeAnchorId(
              proposal.segmentId,
              proposal.quotedText,
              proposal.kind,
            ),
            segmentId: proposal.segmentId,
            quotedText: proposal.quotedText,
            kind: proposal.kind,
            result: {
              anchored: false,
              reason: "segment_not_found",
            },
          });
          continue;
        }

        const anchorResult = anchorQuote(
          segment.normalizedText,
          proposal.quotedText,
          segment.offsetMap,
        );

        results.push({
          anchorId: computeAnchorId(
            proposal.segmentId,
            proposal.quotedText,
            proposal.kind,
          ),
          segmentId: proposal.segmentId,
          quotedText: proposal.quotedText,
          kind: proposal.kind,
          result: anchorResult,
        });
      }

      await anchoringRepository.insertResults(
        documentVersionId,
        results,
        ANCHORER_VERSION,
      );
      await anchoringRepository.updateAnchoringStatus(
        documentVersionId,
        "anchored",
        ANCHORER_VERSION,
      );

      logger.info(
        {
          documentVersionId,
          totalProposals: results.length,
          totalAnchored: results.filter((r) => r.result.anchored).length,
          totalFailed: results.filter((r) => !r.result.anchored).length,
        },
        "document anchoring complete",
      );

      return buildResult(documentVersionId, results);
    },
  };
}

function buildResult(
  documentVersionId: DocumentVersionId,
  results: readonly ProposalAnchorResult[],
): DocumentAnchoringResult {
  return {
    documentVersionId,
    anchorerVersion: ANCHORER_VERSION,
    proposalResults: results,
    totalProposals: results.length,
    totalAnchored: results.filter((r) => r.result.anchored).length,
    totalFailed: results.filter((r) => !r.result.anchored).length,
  };
}
