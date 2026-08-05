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
