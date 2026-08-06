import { AppError } from "../shared/errors.js";

export function unsupportedMimeType(mimeType: string): AppError {
  return new AppError({
    code: "UNSUPPORTED_MIME_TYPE",
    category: "user_input",
    message: `Unsupported file type: ${mimeType}. Supported types: text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
    retryable: false,
    context: { mimeType },
  });
}

export function fileTooLarge(byteSize: number, maxSize: number): AppError {
  return new AppError({
    code: "FILE_TOO_LARGE",
    category: "user_input",
    message: `File size ${byteSize} bytes exceeds maximum ${maxSize} bytes`,
    retryable: false,
    context: { byteSize, maxSize },
  });
}

export function corruptFile(reason: string): AppError {
  return new AppError({
    code: "CORRUPT_FILE",
    category: "user_input",
    message: `File is corrupt or unreadable: ${reason}`,
    retryable: false,
    context: { reason },
  });
}

export function duplicateVersion(
  documentId: string,
  contentHash: string,
): AppError {
  return new AppError({
    code: "DUPLICATE_VERSION",
    category: "user_input",
    message: `Document version with hash ${contentHash} already exists for document ${documentId}`,
    retryable: false,
    context: { documentId, contentHash },
  });
}

export function missingStatusProvenance(
  legislativeStatus: string,
): AppError {
  return new AppError({
    code: "MISSING_STATUS_PROVENANCE",
    category: "user_input",
    message: `legislativeStatus "${legislativeStatus}" requires both authoritativeSource and asOfDate`,
    retryable: false,
    context: { legislativeStatus },
  });
}

export function identityMismatch(
  documentId: string,
  field: string,
  expected: string,
  actual: string,
): AppError {
  return new AppError({
    code: "IDENTITY_MISMATCH",
    category: "user_input",
    message: `legalIdentity.${field} "${actual}" does not match document ${documentId} ("${expected}")`,
    retryable: false,
    context: { documentId, field, expected, actual },
  });
}

export function invalidInput(
  field: string,
  reason: string,
): AppError {
  return new AppError({
    code: "INVALID_INPUT",
    category: "user_input",
    message: `Invalid ${field}: ${reason}`,
    retryable: false,
    context: { field, reason },
  });
}
