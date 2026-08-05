export const ErrorCategory = {
  user_input: "user_input",
  unsupported_document: "unsupported_document",
  provider_failure: "provider_failure",
  verification_failure: "verification_failure",
  internal: "internal",
} as const;
export type ErrorCategory =
  (typeof ErrorCategory)[keyof typeof ErrorCategory];

export interface AppErrorOptions {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(opts: AppErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.category = opts.category;
    this.retryable = opts.retryable;
    this.context = opts.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export function envValidationError(message: string): AppError {
  return new AppError({
    code: "ENV_VALIDATION_FAILED",
    category: "internal",
    message,
    retryable: false,
  });
}

export function databaseConnectionError(cause: unknown): AppError {
  return new AppError({
    code: "DATABASE_CONNECTION_FAILED",
    category: "provider_failure",
    message: "Failed to connect to database",
    retryable: true,
    cause,
  });
}

export function storageConnectionError(cause: unknown): AppError {
  return new AppError({
    code: "STORAGE_CONNECTION_FAILED",
    category: "provider_failure",
    message: "Failed to connect to object storage",
    retryable: true,
    cause,
  });
}

export function sidecarConnectionError(cause: unknown): AppError {
  return new AppError({
    code: "SIDECAR_CONNECTION_FAILED",
    category: "provider_failure",
    message: "Failed to connect to parser sidecar",
    retryable: true,
    cause,
  });
}
