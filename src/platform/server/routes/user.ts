import type { FastifyInstance } from "fastify";
import type { UserRepository } from "../../db/user-repository.js";
import type { Logger } from "../../logger/logger.js";

export interface UserRoutesDeps {
  userRepository: UserRepository;
  logger: Logger;
}

export function registerUserRoutes(
  app: FastifyInstance,
  deps: UserRoutesDeps,
): void {
  const { userRepository, logger } = deps;

  app.get("/api/v1/user/me", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const user = await userRepository.getUser(userId);
    if (!user) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const billCount = await userRepository.getTrackedBillCount(userId);
    const conn = await userRepository.getCalendarConnection(userId);
    return reply.send({
      userId: user.userId,
      plan: user.plan,
      trackedBills: billCount,
      billLimit: 3,
      calendarConnected: !!conn,
      calendarProvider: conn?.provider ?? null,
    });
  });

  app.post("/api/v1/user/bills/:dvId/archive", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const { dvId } = req.params as { dvId: string };
    await userRepository.archiveBill(userId, dvId);
    logger.info({ userId, dvId }, "bill archived — slot freed");
    return reply.send({ ok: true });
  });

  app.delete("/api/v1/user/bills/:dvId", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const { dvId } = req.params as { dvId: string };
    await userRepository.untrackBill(userId, dvId);
    logger.info({ userId, dvId }, "bill untracked — slot freed");
    return reply.send({ ok: true });
  });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post("/api/v1/user/bills/sync", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const { dvIds } = req.body as { dvIds: string[] };
    if (!Array.isArray(dvIds)) {
      return reply.status(400).send({ error: { code: "INVALID_BODY", message: "dvIds must be an array" } });
    }
    let added = 0;
    for (const dvId of dvIds) {
      if (!UUID_RE.test(dvId)) continue;
      const tracked = await userRepository.isTracked(userId, dvId);
      if (!tracked) {
        try {
          await userRepository.trackBill(userId, dvId);
          added++;
        } catch {
          // dvId may not exist in document_versions — skip
        }
      }
    }
    const billCount = await userRepository.getTrackedBillCount(userId);
    logger.info({ userId, added, billCount }, "bills reconciled");
    return reply.send({ trackedBills: billCount, added });
  });

  app.post("/api/v1/waitlist", async (req, reply) => {
    const userId = req.userId;
    if (!userId) {
      return reply.status(401).send({ error: { code: "NO_SESSION", message: "No session" } });
    }
    const { email, trigger } = req.body as { email: string; trigger: string };
    if (!email || !trigger) {
      return reply.status(400).send({
        error: { code: "MISSING_FIELDS", message: "email and trigger are required" },
      });
    }
    if (!["bill_limit", "calendar_sync"].includes(trigger)) {
      return reply.status(400).send({
        error: { code: "INVALID_TRIGGER", message: "trigger must be bill_limit or calendar_sync" },
      });
    }

    const { entryId } = await userRepository.addWaitlistEntry(userId, email, trigger);
    logger.info({ userId, email, trigger, entryId }, "waitlist entry captured");
    return reply.status(201).send({ entryId, email, trigger });
  });
}
