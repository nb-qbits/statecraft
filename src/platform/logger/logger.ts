import pino from "pino";
import { getCorrelationId } from "./correlation.js";

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    mixin() {
      const correlationId = getCorrelationId();
      return correlationId ? { correlationId } : {};
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
