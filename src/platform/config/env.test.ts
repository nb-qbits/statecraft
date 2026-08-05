import { describe, it, expect } from "vitest";
import { validateEnv } from "./env.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "key",
  S3_SECRET_KEY: "secret",
};

describe("validateEnv", () => {
  it("accepts valid minimal env and applies defaults", () => {
    const env = validateEnv(VALID_ENV);
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.S3_BUCKET).toBe("policyaction");
    expect(env.SIDECAR_URL).toBe("http://localhost:8000");
  });

  it("accepts fully specified env", () => {
    const env = validateEnv({
      ...VALID_ENV,
      NODE_ENV: "production",
      PORT: "8080",
      HOST: "127.0.0.1",
      LOG_LEVEL: "debug",
      S3_REGION: "eu-west-1",
      S3_BUCKET: "custom",
      S3_FORCE_PATH_STYLE: "false",
      SIDECAR_URL: "http://sidecar:8000",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.S3_REGION).toBe("eu-west-1");
    expect(env.S3_BUCKET).toBe("custom");
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("throws on missing DATABASE_URL", () => {
    const { DATABASE_URL: _, ...rest } = VALID_ENV;
    expect(() => validateEnv(rest)).toThrow("Environment validation failed");
    expect(() => validateEnv(rest)).toThrow("DATABASE_URL");
  });

  it("throws on missing S3_ACCESS_KEY", () => {
    const { S3_ACCESS_KEY: _, ...rest } = VALID_ENV;
    expect(() => validateEnv(rest)).toThrow("S3_ACCESS_KEY");
  });

  it("throws on missing S3_SECRET_KEY", () => {
    const { S3_SECRET_KEY: _, ...rest } = VALID_ENV;
    expect(() => validateEnv(rest)).toThrow("S3_SECRET_KEY");
  });

  it("throws on missing S3_ENDPOINT", () => {
    const { S3_ENDPOINT: _, ...rest } = VALID_ENV;
    expect(() => validateEnv(rest)).toThrow("S3_ENDPOINT");
  });

  it("throws on invalid S3_ENDPOINT (not a URL)", () => {
    expect(() => validateEnv({ ...VALID_ENV, S3_ENDPOINT: "not-a-url" })).toThrow(
      "Environment validation failed",
    );
  });

  it("throws on invalid NODE_ENV", () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, NODE_ENV: "staging" }),
    ).toThrow("Environment validation failed");
  });

  it("throws on invalid PORT (out of range)", () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, PORT: "99999" }),
    ).toThrow("Environment validation failed");
  });

  it("throws on invalid PORT (not a number)", () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, PORT: "abc" }),
    ).toThrow("Environment validation failed");
  });

  it("throws on invalid LOG_LEVEL", () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, LOG_LEVEL: "verbose" }),
    ).toThrow("Environment validation failed");
  });

  it("error message lists all failing fields", () => {
    try {
      validateEnv({});
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("DATABASE_URL");
      expect(msg).toContain("S3_ENDPOINT");
      expect(msg).toContain("S3_ACCESS_KEY");
      expect(msg).toContain("S3_SECRET_KEY");
    }
  });
});
