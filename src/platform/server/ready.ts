import type { FastifyInstance } from "fastify";
import type { Logger } from "../logger/logger.js";

export interface ReadinessCheck {
  name: string;
  check: () => Promise<boolean>;
}

export function registerReadyRoute(
  app: FastifyInstance,
  checks: ReadinessCheck[],
  logger: Logger,
): void {
  app.get("/ready", async (_req, reply) => {
    const results = await Promise.allSettled(
      checks.map(async (c) => ({
        name: c.name,
        ok: await c.check(),
      })),
    );

    const details: Record<string, boolean> = {};
    let allOk = true;

    for (const r of results) {
      if (r.status === "fulfilled") {
        details[r.value.name] = r.value.ok;
        if (!r.value.ok) allOk = false;
      } else {
        allOk = false;
      }
    }

    if (!allOk) {
      logger.warn({ details }, "readiness check failed");
    }

    const status = allOk ? 200 : 503;
    return reply.status(status).send({ status: allOk ? "ready" : "not_ready", details });
  });
}
