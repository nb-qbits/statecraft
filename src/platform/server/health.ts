import type { FastifyInstance } from "fastify";
import { currentStageVersions, stageVersionsToRecord } from "../../modules/shared/engine-versions.js";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async (_req, reply) => {
    const versions = stageVersionsToRecord(currentStageVersions());
    return reply.status(200).send({ status: "ok", versions });
  });
}
