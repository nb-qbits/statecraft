import { describe, it, expect } from "vitest";
import {
  AppError,
  envValidationError,
  databaseConnectionError,
  storageConnectionError,
  sidecarConnectionError,
} from "./errors.js";

describe("AppError", () => {
  it("carries code, category, message, and retryable flag", () => {
    const err = new AppError({
      code: "TEST_ERROR",
      category: "internal",
      message: "something broke",
      retryable: false,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.category).toBe("internal");
    expect(err.message).toBe("something broke");
    expect(err.retryable).toBe(false);
    expect(err.context).toEqual({});
  });

  it("carries optional context", () => {
    const err = new AppError({
      code: "WITH_CTX",
      category: "user_input",
      message: "bad input",
      retryable: false,
      context: { field: "email" },
    });

    expect(err.context).toEqual({ field: "email" });
  });

  it("carries optional cause", () => {
    const cause = new Error("root cause");
    const err = new AppError({
      code: "CAUSED",
      category: "provider_failure",
      message: "upstream failed",
      retryable: true,
      cause,
    });

    expect(err.cause).toBe(cause);
  });

  it("serializes to JSON with all fields", () => {
    const err = new AppError({
      code: "JSON_TEST",
      category: "verification_failure",
      message: "verification failed",
      retryable: false,
      context: { documentId: "doc-1" },
    });

    const json = err.toJSON();
    expect(json).toEqual({
      name: "AppError",
      code: "JSON_TEST",
      category: "verification_failure",
      message: "verification failed",
      retryable: false,
      context: { documentId: "doc-1" },
    });
  });
});

describe("error factory functions", () => {
  it("envValidationError is internal and not retryable", () => {
    const err = envValidationError("missing DATABASE_URL");
    expect(err.code).toBe("ENV_VALIDATION_FAILED");
    expect(err.category).toBe("internal");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("DATABASE_URL");
  });

  it("databaseConnectionError is provider_failure and retryable", () => {
    const cause = new Error("ECONNREFUSED");
    const err = databaseConnectionError(cause);
    expect(err.code).toBe("DATABASE_CONNECTION_FAILED");
    expect(err.category).toBe("provider_failure");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });

  it("storageConnectionError is provider_failure and retryable", () => {
    const err = storageConnectionError(new Error("timeout"));
    expect(err.code).toBe("STORAGE_CONNECTION_FAILED");
    expect(err.category).toBe("provider_failure");
    expect(err.retryable).toBe(true);
  });

  it("sidecarConnectionError is provider_failure and retryable", () => {
    const err = sidecarConnectionError(new Error("no route"));
    expect(err.code).toBe("SIDECAR_CONNECTION_FAILED");
    expect(err.category).toBe("provider_failure");
    expect(err.retryable).toBe(true);
  });
});

describe("error categories are exhaustive", () => {
  const categories = [
    "user_input",
    "unsupported_document",
    "provider_failure",
    "verification_failure",
    "internal",
  ] as const;

  it.each(categories)("accepts category %s", (cat) => {
    const err = new AppError({
      code: "CAT_TEST",
      category: cat,
      message: "test",
      retryable: false,
    });
    expect(err.category).toBe(cat);
  });
});
