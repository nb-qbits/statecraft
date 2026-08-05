import { describe, it, expect, vi } from "vitest";
import { createShutdownHandler, type ShutdownDeps } from "./shutdown.js";
import { createLogger } from "../logger/logger.js";

interface TestDeps extends ShutdownDeps {
  exitCode: number | undefined;
  closeCalled: boolean;
}

function makeDeps(overrides?: Partial<ShutdownDeps>): TestDeps {
  let exitCode: number | undefined;
  let closeCalled = false;

  const base: ShutdownDeps = {
    close: async () => {
      closeCalled = true;
    },
    logger: createLogger("silent"),
    exit: (code: number) => {
      exitCode = code;
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    ...overrides,
  };

  return {
    ...base,
    get exitCode() {
      return exitCode;
    },
    get closeCalled() {
      return closeCalled;
    },
  };
}

describe("createShutdownHandler", () => {
  it("calls close and exits with 0 on SIGTERM", async () => {
    const deps = makeDeps();
    const handler = createShutdownHandler(deps);

    await handler("SIGTERM");

    expect(deps.closeCalled).toBe(true);
    expect(deps.exitCode).toBe(0);
  });

  it("calls close and exits with 0 on SIGINT", async () => {
    const deps = makeDeps();
    const handler = createShutdownHandler(deps);

    await handler("SIGINT");

    expect(deps.closeCalled).toBe(true);
    expect(deps.exitCode).toBe(0);
  });

  it("exits with 1 when close throws", async () => {
    const deps = makeDeps({
      close: async () => {
        throw new Error("close failed");
      },
    });
    const handler = createShutdownHandler(deps);

    await handler("SIGTERM");

    expect(deps.exitCode).toBe(1);
  });

  it("ignores duplicate shutdown signals", async () => {
    let closeCount = 0;
    const deps = makeDeps({
      close: async () => {
        closeCount++;
      },
    });
    const handler = createShutdownHandler(deps);

    await handler("SIGTERM");
    await handler("SIGTERM");

    expect(closeCount).toBe(1);
    expect(deps.exitCode).toBe(0);
  });

  it("forces exit on timeout when close never resolves", async () => {
    vi.useFakeTimers();
    let exitCode: number | undefined;
    try {
      const deps = makeDeps({
        close: () => new Promise(() => {}),
        exit: (code: number) => {
          exitCode = code;
        },
        setTimeout: globalThis.setTimeout as ShutdownDeps["setTimeout"],
        clearTimeout: globalThis.clearTimeout as ShutdownDeps["clearTimeout"],
      });
      const handler = createShutdownHandler(deps);

      void handler("SIGTERM");

      await vi.advanceTimersByTimeAsync(16_000);

      expect(exitCode).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs the signal name", async () => {
    const infoCalls: unknown[][] = [];
    const logger = createLogger("silent");
    const origInfo = logger.info.bind(logger);
    logger.info = ((...args: unknown[]) => {
      infoCalls.push(args);
      return origInfo(...(args as [string]));
    }) as typeof logger.info;

    const deps = makeDeps({ logger });
    const handler = createShutdownHandler(deps);

    await handler("SIGTERM");

    const signalLog = infoCalls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "signal" in call[0] &&
        (call[0] as Record<string, unknown>).signal === "SIGTERM",
    );
    expect(signalLog).toBeDefined();
  });
});
