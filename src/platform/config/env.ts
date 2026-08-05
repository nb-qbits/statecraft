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

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const result = envSchema.safeParse(source);
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
