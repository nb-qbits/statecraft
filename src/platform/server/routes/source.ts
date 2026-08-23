import type { FastifyInstance } from "fastify";
import type { Logger } from "../../logger/logger.js";
import type { IngestionRepository } from "../../../modules/ingestion/service.js";
import type { ObjectStorage } from "../../storage/storage.js";
import type { DocumentVersionId } from "../../../modules/shared/types.js";

export interface SourceDeps {
  ingestionRepository: IngestionRepository;
  storage: ObjectStorage;
  logger: Logger;
}

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export function registerSourceRoutes(
  app: FastifyInstance,
  deps: SourceDeps,
): void {
  const { ingestionRepository, storage, logger } = deps;

  app.get<{ Params: { documentVersionId: string } }>(
    "/api/v1/documents/:documentVersionId/source",
    async (req, reply) => {
      const dvId = req.params.documentVersionId as DocumentVersionId;

      const version = await ingestionRepository.getVersion(dvId);
      if (!version) {
        return reply.status(404).send({
          error: { code: "DOCUMENT_NOT_FOUND", message: `Document version ${dvId} not found` },
        });
      }

      const storageKey = `documents/${version.contentHash}`;
      let bytes: Buffer;
      try {
        bytes = await storage.get(storageKey);
      } catch (err) {
        logger.error({ err, dvId, storageKey }, "failed to retrieve document from storage");
        return reply.status(404).send({
          error: { code: "FILE_NOT_FOUND", message: "Source file not found in storage" },
        });
      }

      const ext = MIME_TO_EXT[version.mimeType] ?? "";
      const identity = version.legalIdentity;
      const filename = `${identity.instrumentType}-${identity.number}${ext}`;

      return reply
        .header("Content-Type", version.mimeType)
        .header("Content-Length", bytes.length)
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .header("Cache-Control", "private, max-age=3600")
        .send(bytes);
    },
  );
}
