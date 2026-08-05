import { validateEnv } from "./platform/config/env.js";
import { createLogger } from "./platform/logger/logger.js";
import { createServer } from "./platform/server/server.js";
import { createDbPool, checkDbConnection } from "./platform/db/client.js";
import { createS3Client, checkS3Connection } from "./platform/storage/check.js";

async function main(): Promise<void> {
  const env = validateEnv();
  const logger = createLogger(env.LOG_LEVEL);

  logger.info("starting policyaction");

  const dbPool = createDbPool(env.DATABASE_URL);
  const s3Client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
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

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, "server listening");
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
