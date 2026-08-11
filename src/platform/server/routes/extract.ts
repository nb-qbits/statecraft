import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentExtractionResult } from "../../../modules/extraction/types.js";

interface ExtractionService {
  extractDocument(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentExtractionResult>;
}

export function registerExtractionRoutes(
  app: FastifyInstance,
  extractionService: ExtractionService,
  logger: Logger,
): void {
  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/extract",
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
        const result = await extractionService.extractDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          extractorVersion: result.extractorVersion,
          segmentCount: result.totalSegmentsProcessed,
          segmentsSkipped: result.totalSegmentsSkipped,
          totalProposals: result.totalProposals,
          totalRepaired: result.totalRepaired,
          segments: result.segmentResults.map((sr) => ({
            segmentId: sr.segmentId,
            modelCallId: sr.modelCallId,
            repaired: sr.repaired,
            proposals: sr.proposals.map((p) => ({
              segmentId: p.segmentId,
              quotedText: p.quotedText,
              kind: p.kind,
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
            case "provider_failure":
              status = 502;
              break;
            default:
              status = 500;
          }
          logger.warn({ err: err.toJSON() }, "extraction failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected extraction error");
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
