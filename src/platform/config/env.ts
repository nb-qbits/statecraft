import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),

  DATABASE_URL: z
    .string()
    .min(1)
    .describe("Postgres connection string"),

  S3_ENDPOINT: z.string().url().describe("S3-compatible endpoint (MinIO locally)"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).default("policyaction"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  SIDECAR_URL: z
    .string()
    .url()
    .default("http://localhost:8000")
    .describe("Python parser sidecar base URL"),

  OPENSTATES_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("Open States API key — if absent, legislativeStatus stays unknown"),

  MODEL_ID: z
    .string()
    .min(1)
    .optional()
    .describe("Model identifier for span extraction (e.g. claude-sonnet-4-20250514)"),

  EVALUATOR_MODEL_ID: z
    .string()
    .min(1)
    .optional()
    .describe("Model identifier for support evaluation — must differ from MODEL_ID for lineage separation"),

  MODEL_PROVIDER: z
    .enum(["anthropic", "openai"])
    .optional()
    .describe("Model provider — when set with MODEL_API_KEY, enables live extraction"),

  MODEL_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe("API key for the model provider — required only for live extraction"),

  MODEL_BASE_URL: z
    .string()
    .url()
    .optional()
    .describe("Base URL for the model provider API"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  COOKIE_SECRET: z
    .string()
    .min(16)
    .default("dev-cookie-secret-not-for-production")
    .describe("Secret for signing session cookies"),

  GOOGLE_CLIENT_ID: z
    .string()
    .min(1)
    .optional()
    .describe("Google OAuth client ID for Calendar sync"),

  GOOGLE_CLIENT_SECRET: z
    .string()
    .min(1)
    .optional()
    .describe("Google OAuth client secret for Calendar sync"),

  GOOGLE_REDIRECT_URI: z
    .string()
    .min(1)
    .optional()
    .describe("Google OAuth redirect URI"),
});

export type Env = z.infer<typeof envSchema>;

const OPTIONAL_KEYS = [
  "OPENSTATES_API_KEY", "MODEL_ID", "EVALUATOR_MODEL_ID",
  "MODEL_PROVIDER", "MODEL_API_KEY", "MODEL_BASE_URL",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
] as const;

export function validateEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const cleaned = { ...source };
  for (const key of OPTIONAL_KEYS) {
    if (cleaned[key] === "") cleaned[key] = undefined;
  }
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Environment validation failed:\n${formatted}\n\nRequired variables may be missing or malformed. See .env.example.`,
    );
  }
  return result.data;
}
