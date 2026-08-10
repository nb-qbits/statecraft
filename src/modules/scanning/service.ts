import type { ParsingRepository } from "../../platform/db/parsing-repository.js";
import type { ScanningRepository } from "../../platform/db/scanning-repository.js";
import type { IngestionRepository } from "../ingestion/service.js";
import type { Logger } from "../../platform/logger/logger.js";
import type { DocumentVersionId, SegmentId } from "../shared/types.js";
import { CoverageState } from "../shared/types.js";
import { AppError } from "../shared/errors.js";
import { scanSegment, SCANNER_VERSION, deriveCoverageState } from "./scanner.js";
import type { DocumentScanResult, SegmentScanResult } from "./types.js";

export interface ScanningServiceDeps {
  parsingRepository: ParsingRepository;
  scanningRepository: ScanningRepository;
  ingestionRepository: IngestionRepository;
  logger: Logger;
}

export function createScanningService(deps: ScanningServiceDeps) {
  const {
    parsingRepository,
    scanningRepository,
    ingestionRepository,
    logger,
  } = deps;

  return {
    async scanDocument(documentVersionId: DocumentVersionId): Promise<DocumentScanResult> {
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

      if (version.parseStatus !== "parsed") {
        throw new AppError({
          code: "DOCUMENT_NOT_PARSED",
          category: "user_input",
          message: `Document version ${documentVersionId} has not been parsed yet (status: ${version.parseStatus})`,
          retryable: false,
          context: { documentVersionId, parseStatus: version.parseStatus },
        });
      }

      if (version.scanStatus === "scanned" && version.scannerVersion === SCANNER_VERSION) {
        const existingCandidates = await scanningRepository.getCandidatesByVersion(documentVersionId);
        const segments = await parsingRepository.getSegmentsByVersion(documentVersionId);

        const segmentMap = new Map<string, SegmentScanResult>();
        for (const seg of segments) {
          segmentMap.set(seg.segmentId, {
            segmentId: seg.segmentId,
            coverageState: CoverageState.screened_no_candidate,
            candidates: [],
          });
        }

        for (const cand of existingCandidates) {
          const existing = segmentMap.get(cand.segmentId);
          if (existing) {
            const updatedCandidates = [...existing.candidates, cand];
            segmentMap.set(cand.segmentId, {
              ...existing,
              coverageState: deriveCoverageState(updatedCandidates),
              candidates: updatedCandidates,
            });
          }
        }

        const segmentResults = [...segmentMap.values()];
        logger.info({ documentVersionId }, "already scanned, returning existing results");
        return {
          documentVersionId,
          scannerVersion: SCANNER_VERSION,
          segmentResults,
          totalCandidates: existingCandidates.length,
          totalSuppressed: existingCandidates.filter(c => c.suppressed).length,
        };
      }

      if (version.scanStatus === "scanned" && version.scannerVersion !== SCANNER_VERSION) {
        logger.info(
          { documentVersionId, storedVersion: version.scannerVersion, currentVersion: SCANNER_VERSION },
          "scanner version changed, re-scanning",
        );
        await scanningRepository.deleteCandidatesByVersion(documentVersionId);
      }

      const segments = await parsingRepository.getSegmentsByVersion(documentVersionId);

      const segmentResults: SegmentScanResult[] = [];
      const allCandidates = [];

      for (const seg of segments) {
        const result = scanSegment(
          seg.segmentId as SegmentId,
          seg.normalizedText,
        );
        segmentResults.push(result);
        allCandidates.push(...result.candidates);
      }

      await scanningRepository.insertCandidates(allCandidates, documentVersionId, SCANNER_VERSION);
      await scanningRepository.updateScanStatus(documentVersionId, "scanned", SCANNER_VERSION);

      const totalSuppressed = allCandidates.filter(c => c.suppressed).length;

      logger.info(
        {
          documentVersionId,
          segmentCount: segments.length,
          candidateCount: allCandidates.length,
          suppressedCount: totalSuppressed,
        },
        "document scanned successfully",
      );

      return {
        documentVersionId,
        scannerVersion: SCANNER_VERSION,
        segmentResults,
        totalCandidates: allCandidates.length,
        totalSuppressed,
      };
    },
  };
}
