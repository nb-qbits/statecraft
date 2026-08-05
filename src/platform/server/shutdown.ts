import type { FastifyInstance } from "fastify";
import type { Logger } from "../logger/logger.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface ShutdownDeps {
  close: () => Promise<void>;
  logger: Logger;
  exit: (code: number) => void;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
}

export function createShutdownHandler(deps: ShutdownDeps) {
  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    deps.logger.info({ signal }, "shutdown signal received, draining");

    const timer = deps.setTimeout(() => {
      deps.logger.error("graceful shutdown timed out, forcing exit");
      deps.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await deps.close();
      deps.logger.info("server closed, exiting");
      deps.clearTimeout(timer);
      deps.exit(0);
    } catch (err) {
      deps.logger.error({ err }, "error during shutdown");
      deps.clearTimeout(timer);
      deps.exit(1);
    }
  };
}

export function registerShutdown(app: FastifyInstance, logger: Logger): void {
  const handler = createShutdownHandler({
    close: () => app.close(),
    logger,
    exit: (code) => process.exit(code),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });

  process.on("SIGTERM", () => void handler("SIGTERM"));
  process.on("SIGINT", () => void handler("SIGINT"));
}
