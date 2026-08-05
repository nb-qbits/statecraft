import { describe, it, expect } from "vitest";
import {
  unsupportedMimeType,
  fileTooLarge,
  corruptFile,
  duplicateVersion,
} from "./errors.js";
import { AppError } from "../shared/errors.js";

describe("ingestion error factories", () => {
  it("unsupportedMimeType is user_input and not retryable", () => {
    const err = unsupportedMimeType("application/pdf");
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("UNSUPPORTED_MIME_TYPE");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("application/pdf");
    expect(err.context.mimeType).toBe("application/pdf");
  });

  it("fileTooLarge is user_input and not retryable", () => {
    const err = fileTooLarge(100_000_000, 50_000_000);
    expect(err.code).toBe("FILE_TOO_LARGE");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
  });

  it("corruptFile is user_input and not retryable", () => {
    const err = corruptFile("invalid ZIP");
    expect(err.code).toBe("CORRUPT_FILE");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("invalid ZIP");
  });

  it("duplicateVersion is user_input and not retryable", () => {
    const err = duplicateVersion("doc-1", "abc123");
    expect(err.code).toBe("DUPLICATE_VERSION");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.context.documentId).toBe("doc-1");
    expect(err.context.contentHash).toBe("abc123");
  });
});
