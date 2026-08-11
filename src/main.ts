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
import { registerParseRoutes } from "./platform/server/routes/parse.js";
import { registerScanRoutes } from "./platform/server/routes/scan.js";
import { createParsingRepository } from "./platform/db/parsing-repository.js";
import { createParsingService } from "./modules/parsing/service.js";
import { createScanningRepository } from "./platform/db/scanning-repository.js";
import { createScanningService } from "./modules/scanning/service.js";
import { createExtractionRepository } from "./platform/db/extraction-repository.js";
import { createExtractionService } from "./modules/extraction/service.js";
import { createFixtureModelGateway } from "./modules/extraction/fixture-model-gateway.js";
import { registerExtractionRoutes } from "./platform/server/routes/extract.js";
import { createAnchoringRepository } from "./platform/db/anchoring-repository.js";
import { createAnchoringService } from "./modules/anchoring/service.js";
import { registerAnchoringRoutes } from "./platform/server/routes/anchor.js";
import { createGrammarRepository } from "./platform/db/grammar-repository.js";
import { createGrammarService } from "./modules/grammar/service.js";
import { registerGrammarRoutes } from "./platform/server/routes/grammar.js";
import { createResolverRepository } from "./platform/db/resolver-repository.js";
import { createResolverService } from "./modules/resolver/service.js";
import { registerResolveRoutes } from "./platform/server/routes/resolve.js";
import { createEvaluationRepository } from "./platform/db/evaluation-repository.js";
import { createEvaluationService } from "./modules/evaluation/service.js";
import { createSupportEvaluator } from "./modules/evaluation/evaluator.js";
import { SUPPORT_EVALUATION_PROMPT } from "./modules/evaluation/evaluator-prompt.js";
import { registerEvaluateRoutes } from "./platform/server/routes/evaluate.js";
import { createPlainTextParser } from "./platform/parsers/plain-text-parser.js";
import { parseDocxAsync } from "./platform/parsers/docx-parser.js";
import { createSidecarClient, createPdfParser } from "./platform/parsers/pdf-parser.js";
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

  const parsingRepository = createParsingRepository(db);
  const sidecarClient = createSidecarClient(env.SIDECAR_URL);
  const parsingService = createParsingService({
    ingestionRepository: repository,
    parsingRepository,
    storage,
    plainTextParser: createPlainTextParser(),
    parseDocx: parseDocxAsync,
    parsePdf: createPdfParser(sidecarClient),
    logger,
  });

  registerParseRoutes(app, parsingService, logger);

  const scanningRepository = createScanningRepository(db);
  const scanningService = createScanningService({
    ingestionRepository: repository,
    parsingRepository,
    scanningRepository,
    logger,
  });

  registerScanRoutes(app, scanningService, logger);

  const extractionRepository = createExtractionRepository(db);

  const PH = "ph_fixture" as import("./modules/shared/types.js").PromptHash;

  const fixtureWithin30Days = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "within 30 days", kind: "duration" },
      { segmentId: "seg_placeholder", quotedText: "no longer than seven days", kind: "duration" },
    ],
  };

  const fixtureWorkingDays = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "every two business days", kind: "duration" },
      { segmentId: "seg_placeholder", quotedText: "within one working day", kind: "duration" },
      { segmentId: "seg_placeholder", quotedText: "within 24 hours", kind: "duration" },
    ],
  };

  const fixtureMedicalEval = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "within five business days of such placement", kind: "duration" },
    ],
  };

  const fixtureSimpleBill = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "within 30 days", kind: "duration" },
      { segmentId: "seg_placeholder", quotedText: "effective date of this act", kind: "effective_date" },
    ],
  };

  const fixtureEffectiveDate = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "July 1, 2025", kind: "effective_date" },
    ],
  };

  const fixtureAdversarialVague = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "sometime next spring", kind: "temporal_constraint" },
      { segmentId: "seg_placeholder", quotedText: "as soon as practicable", kind: "duration" },
    ],
  };

  const fixtureAdversarialAmbiguous = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "within a reasonable period", kind: "duration" },
      { segmentId: "seg_placeholder", quotedText: "30", kind: "duration" },
    ],
  };

  const fixtureAdversarialComplex = {
    proposals: [
      { segmentId: "seg_placeholder", quotedText: "the first day of the fourth month following adjournment", kind: "temporal_constraint" },
    ],
  };

  const emptyFixture = { proposals: [] };

  const modelGateway = createFixtureModelGateway([
    { promptHash: PH, segmentText: "within 30 days without approval from the regional administrator", responsePayload: JSON.stringify(fixtureWithin30Days), parsedContent: fixtureWithin30Days },
    { promptHash: PH, segmentText: "every two business days", responsePayload: JSON.stringify(fixtureWorkingDays), parsedContent: fixtureWorkingDays },
    { promptHash: PH, segmentText: "medical evaluation and a mental health evaluation within one workday", responsePayload: JSON.stringify(fixtureMedicalEval), parsedContent: fixtureMedicalEval },
    { promptHash: PH, segmentText: "within 30 days after the effective date of this act", responsePayload: JSON.stringify(fixtureSimpleBill), parsedContent: fixtureSimpleBill },
    { promptHash: PH, segmentText: "shall become effective on July 1, 2025", responsePayload: JSON.stringify(fixtureEffectiveDate), parsedContent: fixtureEffectiveDate },
    { promptHash: PH, segmentText: "sometime next spring", responsePayload: JSON.stringify(fixtureAdversarialVague), parsedContent: fixtureAdversarialVague },
    { promptHash: PH, segmentText: "within a reasonable period", responsePayload: JSON.stringify(fixtureAdversarialAmbiguous), parsedContent: fixtureAdversarialAmbiguous },
    { promptHash: PH, segmentText: "first day of the fourth month following adjournment", responsePayload: JSON.stringify(fixtureAdversarialComplex), parsedContent: fixtureAdversarialComplex },
    { promptHash: PH, segmentText: "__no_match__", responsePayload: JSON.stringify(emptyFixture), parsedContent: emptyFixture },
  ]);
  const extractionService = createExtractionService({
    ingestionRepository: repository,
    parsingRepository,
    scanningRepository,
    extractionRepository,
    modelGateway,
    modelId: env.MODEL_ID ?? "fixture",
    logger,
  });

  registerExtractionRoutes(app, extractionService, logger);

  const anchoringRepository = createAnchoringRepository(db);
  const anchoringService = createAnchoringService({
    ingestionRepository: repository,
    parsingRepository,
    extractionRepository,
    anchoringRepository,
    logger,
  });

  registerAnchoringRoutes(app, anchoringService, logger);

  const grammarRepository = createGrammarRepository(db);
  const grammarService = createGrammarService({
    ingestionRepository: repository,
    anchoringRepository,
    grammarRepository,
    logger,
  });

  registerGrammarRoutes(app, grammarService, logger);

  const resolverRepository = createResolverRepository(db);
  const resolverService = createResolverService({
    ingestionRepository: repository,
    grammarRepository,
    resolverRepository,
    logger,
  });

  registerResolveRoutes(app, resolverService, logger);

  const evaluationRepository = createEvaluationRepository(db);
  const evaluatorFixture = {
    verdict: "ambiguous",
    reasoning: "fixture evaluator — residual entailment not assessed in fixture mode",
  };
  const evaluatorModelGateway = createFixtureModelGateway([
    {
      promptHash: SUPPORT_EVALUATION_PROMPT.promptHash,
      segmentText: "__eval_match__",
      responsePayload: JSON.stringify(evaluatorFixture),
      parsedContent: evaluatorFixture,
    },
  ]);
  const supportEvaluator = createSupportEvaluator(
    evaluatorModelGateway,
    env.EVALUATOR_MODEL_ID ?? "fixture-evaluator",
  );
  const evaluationService = createEvaluationService({
    ingestionRepository: repository,
    parsingRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    evaluator: supportEvaluator,
    logger,
  });

  registerEvaluateRoutes(app, evaluationService, logger);

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, "server listening");
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
