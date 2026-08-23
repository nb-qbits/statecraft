import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { ExtractionRepository } from "../../platform/db/extraction-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, SegmentId } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import type { ModelGateway } from "./model-gateway.js";
import type {
  DocumentExtractionResult,
  SegmentExtractionResult,
  ModelCallRecord,
} from "./types.js";
import { SPAN_PROPOSAL_PROMPT, renderUserPrompt } from "./prompt-registry.js";
import { validateAndRepairResponse, EXTRACTION_RESPONSE_SCHEMA } from "./response-validator.js";

export const EXTRACTOR_VERSION = "1.4.0";

export interface ExtractionServiceDeps {
  ingestionRepository: IngestionRepository;
  parsingRepository: ParsingRepository;
  scanningRepository: ScanningRepository;
  extractionRepository: ExtractionRepository;
  modelGateway: ModelGateway;
  modelId: string;
  logger: Logger;
}

export function createExtractionService(deps: ExtractionServiceDeps) {
  const {
    ingestionRepository,
    parsingRepository,
    scanningRepository,
    extractionRepository,
    modelGateway,
    modelId,
    logger,
  } = deps;

  return {
    async extractDocument(
      documentVersionId: DocumentVersionId,
    ): Promise<DocumentExtractionResult> {
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

      if (version.scanStatus !== "scanned") {
        throw new AppError({
          code: "DOCUMENT_NOT_SCANNED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been scanned yet (status: ${version.scanStatus})`,
          retryable: false,
          context: { documentVersionId, scanStatus: version.scanStatus },
        });
      }

      if (
        version.extractionStatus === "extracted" &&
        version.extractorVersion === EXTRACTOR_VERSION
      ) {
        const existing =
          await extractionRepository.getCallsByVersion(documentVersionId);
        logger.info(
          { documentVersionId },
          "already extracted, returning existing results",
        );
        return rebuildResult(documentVersionId, existing);
      }

      if (
        version.extractionStatus === "extracted" &&
        version.extractorVersion !== EXTRACTOR_VERSION
      ) {
        logger.info(
          {
            documentVersionId,
            storedVersion: version.extractorVersion,
            currentVersion: EXTRACTOR_VERSION,
          },
          "extractor version changed, re-extracting",
        );
        await extractionRepository.deleteCallsByVersion(documentVersionId);
      }

      const segments =
        await parsingRepository.getSegmentsByVersion(documentVersionId);
      const candidates =
        await scanningRepository.getCandidatesByVersion(documentVersionId);

      const candidatesBySegment = new Map<string, typeof candidates>();
      for (const c of candidates) {
        const existing = candidatesBySegment.get(c.segmentId) ?? [];
        existing.push(c);
        candidatesBySegment.set(c.segmentId, existing);
      }

      const segmentResults: SegmentExtractionResult[] = [];
      const callRecords: ModelCallRecord[] = [];
      let totalSkipped = 0;
      let gatewayErrors = 0;
      let processableSegments = 0;

      for (const seg of segments) {
        const segCandidates = candidatesBySegment.get(seg.segmentId) ?? [];
        const nonSuppressed = segCandidates.filter((c) => !c.suppressed);

        if (nonSuppressed.length === 0) {
          totalSkipped++;
          continue;
        }

        processableSegments++;

        const candidateSummary = nonSuppressed
          .map((c) => `${c.kind}: "${c.matchedText}" (rule: ${c.ruleId})`)
          .join("\n");

        const userPrompt = renderUserPrompt(SPAN_PROPOSAL_PROMPT.userTemplate, {
          segmentId: seg.segmentId,
          candidateSummary,
          normalizedText: seg.normalizedText,
        });

        let response;
        try {
          response = await modelGateway.call({
            modelId,
            systemPrompt: SPAN_PROPOSAL_PROMPT.systemPrompt,
            userPrompt,
            promptHash: SPAN_PROPOSAL_PROMPT.promptHash,
            responseSchema: EXTRACTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
            correlationId: `extract_${documentVersionId}_${seg.segmentId}`,
          });
        } catch (err) {
          logger.error(
            { segmentId: seg.segmentId, err },
            "model gateway call failed",
          );
          gatewayErrors++;
          continue;
        }

        const validation = validateAndRepairResponse(
          response.parsedContent,
          seg.segmentId as SegmentId,
        );

        if (!validation.valid) {
          logger.warn(
            {
              segmentId: seg.segmentId,
              reason: validation.rejectionReason,
            },
            "model response rejected",
          );
          continue;
        }

        const callRecord: ModelCallRecord = {
          modelCallId: response.modelCallId,
          documentVersionId,
          segmentId: seg.segmentId as SegmentId,
          modelId: response.modelId,
          promptHash: response.promptHash,
          requestPayload: response.requestPayload,
          responsePayload: response.responsePayload,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs: response.latencyMs,
          correlationId: response.correlationId,
          repaired: validation.repaired,
          createdAt: new Date().toISOString(),
        };
        callRecords.push(callRecord);

        segmentResults.push({
          segmentId: seg.segmentId as SegmentId,
          proposals: validation.proposals,
          modelCallId: response.modelCallId,
          repaired: validation.repaired,
        });
      }

      if (gatewayErrors > 0 && segmentResults.length === 0 && processableSegments > 0) {
        await extractionRepository.updateExtractionStatus(
          documentVersionId,
          "extraction_failed",
          EXTRACTOR_VERSION,
        );
        throw new AppError({
          code: "EXTRACTION_FAILED",
          category: "provider_failure",
          message: `All ${gatewayErrors} model gateway calls failed`,
          retryable: true,
          context: { documentVersionId, gatewayErrors },
        });
      }

      const totalProposals = segmentResults.reduce(
        (sum, s) => sum + s.proposals.length,
        0,
      );

      if (processableSegments > 0 && totalProposals === 0) {
        await extractionRepository.updateExtractionStatus(
          documentVersionId,
          "extraction_failed",
          EXTRACTOR_VERSION,
        );
        throw new AppError({
          code: "EXTRACTION_EMPTY",
          category: "verification_failure",
          message: `Extraction produced 0 proposals from ${processableSegments} segments with candidates — this indicates a model or configuration failure, not an empty document`,
          retryable: true,
          context: {
            documentVersionId,
            processableSegments,
            segmentsSkipped: totalSkipped,
            gatewayErrors,
          },
        });
      }

      await extractionRepository.insertCalls(callRecords);
      await extractionRepository.updateExtractionStatus(
        documentVersionId,
        "extracted",
        EXTRACTOR_VERSION,
      );

      const totalRepaired = segmentResults.filter((s) => s.repaired).length;

      logger.info(
        {
          documentVersionId,
          segmentsProcessed: segmentResults.length,
          segmentsSkipped: totalSkipped,
          totalProposals,
          totalRepaired,
        },
        "document extraction complete",
      );

      return {
        documentVersionId,
        extractorVersion: EXTRACTOR_VERSION,
        segmentResults,
        totalProposals,
        totalRepaired,
        totalSegmentsProcessed: segmentResults.length,
        totalSegmentsSkipped: totalSkipped,
      };
    },
  };
}

function rebuildResult(
  documentVersionId: DocumentVersionId,
  calls: readonly ModelCallRecord[],
): DocumentExtractionResult {
  const segmentResults: SegmentExtractionResult[] = [];

  for (const call of calls) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.responsePayload);
    } catch {
      continue;
    }

    const validation = validateAndRepairResponse(parsed, call.segmentId);
    if (!validation.valid) continue;

    segmentResults.push({
      segmentId: call.segmentId,
      proposals: validation.proposals,
      modelCallId: call.modelCallId,
      repaired: call.repaired,
    });
  }

  const totalProposals = segmentResults.reduce(
    (sum, s) => sum + s.proposals.length,
    0,
  );

  return {
    documentVersionId,
    extractorVersion: EXTRACTOR_VERSION,
    segmentResults,
    totalProposals,
    totalRepaired: segmentResults.filter((s) => s.repaired).length,
    totalSegmentsProcessed: segmentResults.length,
    totalSegmentsSkipped: 0,
  };
}
