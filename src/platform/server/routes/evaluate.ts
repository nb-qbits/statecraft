import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentEvaluationResult } from "../../../modules/evaluation/types.js";

interface EvaluationService {
  evaluateDocument(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentEvaluationResult>;
}

export function registerEvaluateRoutes(
  app: FastifyInstance,
  evaluationService: EvaluationService,
  logger: Logger,
): void {
  app.post<{
    Params: { documentVersionId: string };
  }>(
    "/api/v1/documents/:documentVersionId/evaluate",
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
        const result = await evaluationService.evaluateDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          evaluatorVersion: result.evaluatorVersion,
          promptHash: result.promptHash,
          approved: result.approved,
          totalEvaluated: result.totalEvaluated,
          totalSupported: result.totalSupported,
          totalAmbiguous: result.totalAmbiguous,
          totalUnsupported: result.totalUnsupported,
          evaluations: result.evaluations.map((e) => ({
            anchorId: e.anchorId,
            segmentId: e.segmentId,
            quotedText: e.quotedText,
            deterministicResult: e.deterministicResult,
            evaluatorVerdict: e.evaluatorVerdict,
            supportLevel: e.supportLevel,
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
          logger.warn({ err: err.toJSON() }, "evaluation failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected evaluation error");
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
