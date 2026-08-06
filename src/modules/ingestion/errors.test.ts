import { describe, it, expect } from "vitest";
import {
  unsupportedMimeType,
  fileTooLarge,
  corruptFile,
  duplicateVersion,
  missingStatusProvenance,
  identityMismatch,
  invalidInput,
} from "./errors.js";
import { AppError } from "../shared/errors.js";

describe("ingestion error factories", () => {
  it("unsupportedMimeType is user_input and not retryable", () => {
    const err = unsupportedMimeType("application/json");
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("UNSUPPORTED_MIME_TYPE");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("application/json");
    expect(err.context.mimeType).toBe("application/json");
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

  it("missingStatusProvenance is user_input and not retryable", () => {
    const err = missingStatusProvenance("enacted");
    expect(err.code).toBe("MISSING_STATUS_PROVENANCE");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("enacted");
    expect(err.message).toContain("authoritativeSource");
  });

  it("identityMismatch is user_input and not retryable", () => {
    const err = identityMismatch("doc-1", "jurisdiction", "us-va", "us-md");
    expect(err.code).toBe("IDENTITY_MISMATCH");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.context.field).toBe("jurisdiction");
    expect(err.context.expected).toBe("us-va");
    expect(err.context.actual).toBe("us-md");
  });

  it("invalidInput is user_input and not retryable", () => {
    const err = invalidInput("legislativeStatus", "must be one of: introduced, enacted, ...");
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.category).toBe("user_input");
    expect(err.retryable).toBe(false);
    expect(err.context.field).toBe("legislativeStatus");
  });
});
