/**
 * POST /api/v1/documents/:documentVersionId/parse
 *
 * Triggers parsing for a document version. Idempotent: if already parsed,
 * returns existing segments. If parse_failed, returns error (no silent retry).
 * PDFs return empty (parsing deferred).
 *
 * Path params:
 *   documentVersionId   UUID of the document version to parse.
 *
 * Responses:
 *   200  Segments returned (parsed or already parsed).
 *   400  Invalid input or previously failed.
 *   404  Document version not found.
 *   422  Parse failed (corrupt/unsupported content).
 *   500  Internal error.
 *
 * Example (curl):
 *   curl -X POST http://localhost:3000/api/v1/documents/<uuid>/parse
 */
import type { FastifyInstance } from "fastify";
import { AppError } from "../../../modules/shared/errors.js";
import type { Logger } from "../../logger/logger.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";

interface ParseService {
  parseDocument(documentVersionId: DocumentVersionId): Promise<unknown[]>;
}

export function registerParseRoutes(
  app: FastifyInstance,
  parseService: ParseService,
  logger: Logger,
): void {
  app.post<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/parse",
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
        const segments = await parseService.parseDocument(
          documentVersionId as DocumentVersionId,
        );

        return reply.status(200).send({
          documentVersionId,
          segmentCount: segments.length,
          segments,
        });
      } catch (err) {
        if (err instanceof AppError) {
          let status: number;
          switch (err.category) {
            case "user_input":
              status = err.code === "DOCUMENT_NOT_FOUND" ? 404 : 400;
              break;
            case "unsupported_document":
              status = 422;
              break;
            default:
              status = 500;
          }
          logger.warn({ err: err.toJSON() }, "parse failed");
          return reply.status(status).send({ error: err.toJSON() });
        }
        logger.error({ err }, "unexpected parse error");
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
