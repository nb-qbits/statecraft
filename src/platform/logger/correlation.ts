import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationContext {
  correlationId: string;
}

const store = new AsyncLocalStorage<CorrelationContext>();

export function runWithCorrelation<T>(
  correlationId: string,
  fn: () => T,
): T {
  return store.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return store.getStore()?.correlationId;
}

export function newCorrelationId(): string {
  return randomUUID();
}
