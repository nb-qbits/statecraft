import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentResolutionResult } from "../../../modules/resolver/service.js";
import type { ResolutionInput } from "../../../modules/resolver/types.js";

interface ResolverService {
  resolveDocument(
    documentVersionId: DocumentVersionId,
    suppliedInputs?: readonly ResolutionInput[],
  ): Promise<DocumentResolutionResult>;
}

export function registerResolveRoutes(
  app: FastifyInstance,
  resolverService: ResolverService,
  logger: Logger,
): void {
  app.post<{
    Params: { documentVersionId: string };
    Body: { inputs?: ResolutionInput[] };
  }>(
    "/api/v1/documents/:documentVersionId/resolve",
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

      const suppliedInputs: ResolutionInput[] =
        (req.body as { inputs?: ResolutionInput[] })?.inputs ?? [];

      try {
        const result = await resolverService.resolveDocument(
          documentVersionId as DocumentVersionId,
          suppliedInputs,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          resolverVersion: result.resolverVersion,
          totalExpressions: result.totalExpressions,
          totalResolved: result.totalResolved,
          totalUnresolved: result.totalUnresolved,
          results: result.results.map((r) => ({
            anchorId: r.anchorId,
            segmentId: r.segmentId,
            text: r.text,
            expression: r.expression,
            result: r.result,
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
          logger.warn({ err: err.toJSON() }, "resolution failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected resolution error");
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
