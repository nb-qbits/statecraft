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
import { createLiveModelGateway } from "./modules/extraction/live-model-gateway.js";
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
import { createRoutingRepository } from "./platform/db/routing-repository.js";
import { createRoutingService } from "./modules/routing/service.js";
import { registerRouteRoutes } from "./platform/server/routes/route.js";
import { createReviewRepository } from "./platform/db/review-repository.js";
import { createReviewService } from "./modules/review/service.js";
import { registerReviewRoutes } from "./platform/server/routes/review.js";
import { registerAnalyzeRoutes } from "./platform/server/routes/analyze.js";
import { registerFindingsRoutes } from "./platform/server/routes/findings.js";
import { registerExportRoutes } from "./platform/server/routes/export.js";
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

  const modelGateway = (() => {
    if (env.MODEL_PROVIDER && env.MODEL_API_KEY) {
      logger.info({ provider: env.MODEL_PROVIDER }, "live model gateway enabled");
      return createLiveModelGateway({
        provider: env.MODEL_PROVIDER,
        apiKey: env.MODEL_API_KEY,
        baseUrl: env.MODEL_BASE_URL,
      });
    }

    logger.info("no MODEL_PROVIDER configured — using fixture model gateway");
    const PH = "ph_fixture" as import("./modules/shared/types.js").PromptHash;
    const f = (proposals: Array<{ segmentId: string; quotedText: string; kind: string }>) => ({
      proposals,
    });
    const seg = "seg_placeholder";
    return createFixtureModelGateway([
      { promptHash: PH, segmentText: "within 30 days without approval from the regional administrator", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "within 30 days", kind: "duration" }, { segmentId: seg, quotedText: "no longer than seven days", kind: "duration" }])), parsedContent: f([{ segmentId: seg, quotedText: "within 30 days", kind: "duration" }, { segmentId: seg, quotedText: "no longer than seven days", kind: "duration" }]) },
      { promptHash: PH, segmentText: "every two business days", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "every two business days", kind: "duration" }, { segmentId: seg, quotedText: "within one working day", kind: "duration" }, { segmentId: seg, quotedText: "within 24 hours", kind: "duration" }])), parsedContent: f([{ segmentId: seg, quotedText: "every two business days", kind: "duration" }, { segmentId: seg, quotedText: "within one working day", kind: "duration" }, { segmentId: seg, quotedText: "within 24 hours", kind: "duration" }]) },
      { promptHash: PH, segmentText: "medical evaluation and a mental health evaluation within one workday", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "within five business days of such placement", kind: "duration" }])), parsedContent: f([{ segmentId: seg, quotedText: "within five business days of such placement", kind: "duration" }]) },
      { promptHash: PH, segmentText: "within 30 days after the effective date of this act", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "within 30 days", kind: "duration" }, { segmentId: seg, quotedText: "effective date of this act", kind: "effective_date" }])), parsedContent: f([{ segmentId: seg, quotedText: "within 30 days", kind: "duration" }, { segmentId: seg, quotedText: "effective date of this act", kind: "effective_date" }]) },
      { promptHash: PH, segmentText: "shall become effective on July 1, 2025", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "July 1, 2025", kind: "effective_date" }])), parsedContent: f([{ segmentId: seg, quotedText: "July 1, 2025", kind: "effective_date" }]) },
      { promptHash: PH, segmentText: "sometime next spring", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "sometime next spring", kind: "temporal_constraint" }, { segmentId: seg, quotedText: "as soon as practicable", kind: "duration" }])), parsedContent: f([{ segmentId: seg, quotedText: "sometime next spring", kind: "temporal_constraint" }, { segmentId: seg, quotedText: "as soon as practicable", kind: "duration" }]) },
      { promptHash: PH, segmentText: "within a reasonable period", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "within a reasonable period", kind: "duration" }, { segmentId: seg, quotedText: "30", kind: "duration" }])), parsedContent: f([{ segmentId: seg, quotedText: "within a reasonable period", kind: "duration" }, { segmentId: seg, quotedText: "30", kind: "duration" }]) },
      { promptHash: PH, segmentText: "first day of the fourth month following adjournment", responsePayload: JSON.stringify(f([{ segmentId: seg, quotedText: "the first day of the fourth month following adjournment", kind: "temporal_constraint" }])), parsedContent: f([{ segmentId: seg, quotedText: "the first day of the fourth month following adjournment", kind: "temporal_constraint" }]) },
      { promptHash: PH, segmentText: "__no_match__", responsePayload: JSON.stringify(f([])), parsedContent: f([]) },
    ]);
  })();

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
  const evaluatorModelGateway = (() => {
    if (env.MODEL_PROVIDER && env.MODEL_API_KEY) {
      return createLiveModelGateway({
        provider: env.MODEL_PROVIDER,
        apiKey: env.MODEL_API_KEY,
        baseUrl: env.MODEL_BASE_URL,
      });
    }
    const evaluatorFixture = {
      verdict: "ambiguous",
      reasoning: "fixture evaluator — residual entailment not assessed in fixture mode",
    };
    return createFixtureModelGateway([
      {
        promptHash: SUPPORT_EVALUATION_PROMPT.promptHash,
        segmentText: "__eval_match__",
        responsePayload: JSON.stringify(evaluatorFixture),
        parsedContent: evaluatorFixture,
      },
    ]);
  })();
  const supportEvaluator = createSupportEvaluator(
    evaluatorModelGateway,
    env.EVALUATOR_MODEL_ID ?? env.MODEL_ID ?? "fixture-evaluator",
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

  const routingRepository = createRoutingRepository(db);
  const routingService = createRoutingService({
    ingestionRepository: repository,
    parsingRepository,
    scanningRepository,
    evaluationRepository,
    grammarRepository,
    resolverRepository,
    routingRepository,
    logger,
  });

  registerRouteRoutes(app, routingService, routingRepository, logger);

  const pipelineServices = {
    parse: (dvId: import("./modules/shared/types.js").DocumentVersionId) => parsingService.parseDocument(dvId).then(() => {}),
    scan: (dvId: import("./modules/shared/types.js").DocumentVersionId) => scanningService.scanDocument(dvId).then(() => {}),
    extract: (dvId: import("./modules/shared/types.js").DocumentVersionId) => extractionService.extractDocument(dvId).then(() => {}),
    anchor: (dvId: import("./modules/shared/types.js").DocumentVersionId) => anchoringService.anchorDocument(dvId).then(() => {}),
    parseGrammar: (dvId: import("./modules/shared/types.js").DocumentVersionId) => grammarService.parseDocument(dvId).then(() => {}),
    resolve: (dvId: import("./modules/shared/types.js").DocumentVersionId) => resolverService.resolveDocument(dvId).then(() => {}),
    evaluate: (dvId: import("./modules/shared/types.js").DocumentVersionId) => evaluationService.evaluateDocument(dvId).then(() => {}),
    route: (dvId: import("./modules/shared/types.js").DocumentVersionId) => routingService.routeDocument(dvId).then(() => {}),
  };

  const reviewRepository = createReviewRepository(db);
  const reviewService = createReviewService({
    reviewRepository,
    ingestionRepository: repository,
    parsingRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    routingRepository,
    extractionRepository,
    pipeline: pipelineServices,
    logger,
  });

  registerReviewRoutes(app, reviewService, reviewRepository, logger);

  registerAnalyzeRoutes(app, {
    ingestionRepository: repository,
    parsingRepository,
    scanningRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    routingRepository,
    reviewRepository,
    pipeline: pipelineServices,
    logger,
  });

  registerFindingsRoutes(app, {
    ingestionRepository: repository,
    parsingRepository,
    anchoringRepository,
    grammarRepository,
    resolverRepository,
    evaluationRepository,
    routingRepository,
    reviewRepository,
    logger,
  });

  registerExportRoutes(app, {
    reviewRepository,
    logger,
  });

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, "server listening");
}

main().catch((err) => {
  console.error("fatal startup error:", err);
  process.exit(1);
});
