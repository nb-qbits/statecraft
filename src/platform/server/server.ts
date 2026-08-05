import Fastify, { type FastifyInstance } from "fastify";
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

  registerHealthRoute(app);
  registerReadyRoute(app, opts.readinessChecks, opts.logger);
  registerShutdown(app, opts.logger);

  return app;
}
