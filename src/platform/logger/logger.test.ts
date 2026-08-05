import { describe, it, expect } from "vitest";
import { createLogger } from "./logger.js";
import { runWithCorrelation, getCorrelationId } from "./correlation.js";
import pino from "pino";
import { PassThrough } from "node:stream";

function captureLogger(): {
  logger: pino.Logger;
  getLines: () => Record<string, unknown>[];
} {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));

  const logger = pino(
    {
      level: "info",
      formatters: { level: (label) => ({ level: label }) },
      mixin() {
        const cid = getCorrelationId();
        return cid ? { correlationId: cid } : {};
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream,
  );

  return {
    logger,
    getLines() {
      return Buffer.concat(chunks)
        .toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}

describe("createLogger", () => {
  it("creates a logger at the specified level", () => {
    const logger = createLogger("info");
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("creates a logger at debug level", () => {
    const logger = createLogger("debug");
    expect(logger.level).toBe("debug");
  });
});

describe("correlation ID propagation", () => {
  it("includes correlationId in log output when set", () => {
    const { logger, getLines } = captureLogger();

    runWithCorrelation("test-correlation-123", () => {
      logger.info("test message");
    });

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.correlationId).toBe("test-correlation-123");
  });

  it("omits correlationId when not in correlation context", () => {
    const { logger, getLines } = captureLogger();
    logger.info("test message");

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty("correlationId");
  });
});
