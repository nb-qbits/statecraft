import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentAnchoringResult } from "../../../modules/anchoring/types.js";

interface AnchoringService {
  anchorDocument(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentAnchoringResult>;
}

export function registerAnchoringRoutes(
  app: FastifyInstance,
  anchoringService: AnchoringService,
  logger: Logger,
): void {
  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/anchor",
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
        const result = await anchoringService.anchorDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          anchorerVersion: result.anchorerVersion,
          totalProposals: result.totalProposals,
          totalAnchored: result.totalAnchored,
          totalFailed: result.totalFailed,
          results: result.proposalResults.map((pr) => ({
            anchorId: pr.anchorId,
            segmentId: pr.segmentId,
            quotedText: pr.quotedText,
            kind: pr.kind,
            anchored: pr.result.anchored,
            ...(pr.result.anchored
              ? {
                  method: pr.result.method,
                  normalizedStart: pr.result.normalizedStart,
                  normalizedEnd: pr.result.normalizedEnd,
                  originalStart: pr.result.originalStart,
                  originalEnd: pr.result.originalEnd,
                }
              : {
                  reason: pr.result.reason,
                }),
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
          logger.warn({ err: err.toJSON() }, "anchoring failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected anchoring error");
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
