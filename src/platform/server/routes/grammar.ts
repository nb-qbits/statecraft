import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";
import type { DocumentGrammarResult } from "../../../modules/grammar/service.js";

interface GrammarService {
  parseDocument(
    documentVersionId: DocumentVersionId,
  ): Promise<DocumentGrammarResult>;
}

export function registerGrammarRoutes(
  app: FastifyInstance,
  grammarService: GrammarService,
  logger: Logger,
): void {
  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/parse-temporal",
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
        const result = await grammarService.parseDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId: result.documentVersionId,
          grammarVersion: result.grammarVersion,
          totalSpans: result.totalSpans,
          totalParsed: result.totalParsed,
          totalFailed: result.totalFailed,
          results: result.results.map((r) => ({
            anchorId: r.anchorId,
            segmentId: r.segmentId,
            text: r.text,
            ...(r.result.parsed
              ? { parsed: true, expression: r.result.expression }
              : {
                  parsed: false,
                  reason: r.result.reason,
                  position: r.result.position,
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
          logger.warn({ err: err.toJSON() }, "grammar parsing failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected grammar parsing error");
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
