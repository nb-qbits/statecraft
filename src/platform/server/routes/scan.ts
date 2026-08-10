import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentScanResult } from "../../../modules/scanning/types.js";

interface ScanService {
  scanDocument(documentVersionId: DocumentVersionId): Promise<DocumentScanResult>;
}

export function registerScanRoutes(
  app: FastifyInstance,
  scanService: ScanService,
  logger: Logger,
): void {
  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/scan",
    async (req, reply) => {
      const { documentVersionId } = req.params;

      if (!documentVersionId || documentVersionId.length < 10) {
        return reply.status(400).send({
          error: {
            code: "INVALID_INPUT",
            message: "documentVersionId is required",
          },
        });
      }

      try {
        const result = await scanService.scanDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          scannerVersion: result.scannerVersion,
          segmentCount: result.segmentResults.length,
          totalCandidates: result.totalCandidates,
          totalSuppressed: result.totalSuppressed,
          segments: result.segmentResults.map(sr => ({
            segmentId: sr.segmentId,
            coverageState: sr.coverageState,
            candidates: sr.candidates.map(c => ({
              candidateId: c.candidateId,
              kind: c.kind,
              ruleId: c.ruleId,
              matchedText: c.matchedText,
              matchStart: c.matchStart,
              matchEnd: c.matchEnd,
              suppressed: c.suppressed,
            })),
          })),
        });
      } catch (err) {
        if (err instanceof AppError) {
          let status: number;
          switch (err.category) {
            case "user_input":
              status = err.code === "DOCUMENT_NOT_FOUND" ? 404 : 400;
              break;
            default:
              status = 500;
          }
          logger.warn({ err: err.toJSON() }, "scan failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected scan error");
        return reply.status(500).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
          },
        });
      }
    },
  );
}
