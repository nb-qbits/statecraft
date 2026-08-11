import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentRoutingResult } from "../../../modules/routing/types.js";

interface RoutingService {
  routeDocument(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentRoutingResult>;
}

export function registerRouteRoutes(
  app: FastifyInstance,
  routingService: RoutingService,
  logger: Logger,
): void {
  app.post<{
    Params: { documentVersionId: string };
  }>(
    "/api/v1/documents/:documentVersionId/route",
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
        const result = await routingService.routeDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          routerVersion: result.routerVersion,
          totalAssignments: result.totalAssignments,
          laneSummary: result.laneSummary,
          processingCoverage: {
            label: "processing_coverage",
            note: "This is processing coverage, not measured recall. It does not certify that no obligation exists in unaccounted segments.",
            totalSegments: result.coverage.totalSegments,
            withCandidates: result.coverage.withCandidates,
            screenedNoCandidate: result.coverage.screenedNoCandidate,
            needsSweep: result.coverage.needsSweep,
          },
          assignments: result.assignments.map((a) => ({
            anchorId: a.anchorId,
            segmentId: a.segmentId,
            lane: a.lane,
            reasons: a.reasons,
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
          logger.warn({ err: err.toJSON() }, "routing failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected routing error");
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
