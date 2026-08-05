import { validateEnv } from "./platform/config/env.js";
import { createLogger } from "./platform/logger/logger.js";
import { createServer } from "./platform/server/server.js";
import { createDbPool, createDb, checkDbConnection } from "./platform/db/client.js";
import { createS3Client, checkS3Connection } from "./platform/storage/check.js";
import { createObjectStorage } from "./platform/storage/storage.js";
import { createIngestionRepository } from "./platform/db/ingestion-repository.js";
import { createIngestionService } from "./modules/ingestion/service.js";
import { createNullMetadataSource } from "./modules/ingestion/legislative-metadata.js";
import { createOpenStatesSource } from "./platform/legislative/openstates.js";
import { registerUploadRoutes } from "./platform/server/routes/upload.js";
import multipart from "@fastify/multipart";

async function main(): Promise<void> {
  const env = validateEnv();
  const logger = createLogger(env.LOG_LEVEL);

  logger.info("starting policyaction");

  const dbPool = createDbPool(env.DATABASE_URL);
  const db = createDb(dbPool);

  const s3Opts = {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
  const s3Client = createS3Client(s3Opts);
  const storage = createObjectStorage({ ...s3Opts, bucket: env.S3_BUCKET });

  const metadataSource = env.OPENSTATES_API_KEY
    ? createOpenStatesSource(env.OPENSTATES_API_KEY, logger)
    : createNullMetadataSource();

  if (!env.OPENSTATES_API_KEY) {
    logger.warn(
      "OPENSTATES_API_KEY not configured — legislativeStatus will remain unknown",
    );
  }

  const repository = createIngestionRepository(db);
  const ingestionService = createIngestionService({
    repository,
    storage,
    metadataSource,
    logger,
  });

  const app = await createServer({
    host: env.HOST,
    port: env.PORT,
    logger,
    readinessChecks: [
      { name: "postgres", check: () => checkDbConnection(dbPool) },
      { name: "s3", check: () => checkS3Connection(s3Client) },
    ],
  });

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  registerUploadRoutes(app, ingestionService, logger);

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, "server listening");
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
