import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import type { Logger } from "../logger/logger.js";
import { newCorrelationId, runWithCorrelation } from "../logger/correlation.js";
import { registerHealthRoute } from "./health.js";
import { registerReadyRoute, type ReadinessCheck } from "./ready.js";
import { registerShutdown } from "./shutdown.js";

export interface ServerOptions {
  host: string;
  port: number;
  logger: Logger;
  readinessChecks: ReadinessCheck[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createServer(
  opts: ServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const correlationMap = new WeakMap<object, string>();

  app.addHook("onRequest", async (req, reply) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string | undefined) ??
      newCorrelationId();
    correlationMap.set(req, correlationId);
    void reply.header("x-correlation-id", correlationId);
  });

  app.addHook("onRequest", async (req) => {
    const correlationId = correlationMap.get(req) ?? "unknown";
    runWithCorrelation(correlationId, () => {
      opts.logger.info(
        { method: req.method, url: req.url, correlationId },
        "request received",
      );
    });
  });

  app.addHook("onResponse", async (req, reply) => {
    const correlationId = correlationMap.get(req) ?? "unknown";
    runWithCorrelation(correlationId, () => {
      opts.logger.info(
        {
          method: req.method,
          url: req.url,
          statusCode: reply.statusCode,
          correlationId,
        },
        "request completed",
      );
    });
  });

  app.addHook("preHandler", async (req, reply) => {
    const params = req.params as Record<string, string> | undefined;
    if (params?.documentVersionId && !UUID_RE.test(params.documentVersionId)) {
      return reply.status(400).send({
        error: {
          code: "INVALID_DOCUMENT_VERSION_ID",
          message: `Invalid document version ID: "${params.documentVersionId}" is not a valid UUID`,
        },
      });
    }
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const correlationId = correlationMap.get(req) ?? "unknown";
    const statusCode = error.statusCode ?? 500;

    runWithCorrelation(correlationId, () => {
      opts.logger.error(
        {
          err: error,
          method: req.method,
          url: req.url,
          statusCode,
          correlationId,
        },
        error.message ?? "unhandled error",
      );
    });

    void reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message: statusCode >= 500 ? "Internal server error" : error.message,
        correlationId,
      },
    });
  });

  registerHealthRoute(app);
  registerReadyRoute(app, opts.readinessChecks, opts.logger);
  registerShutdown(app, opts.logger);

  return app;
}
