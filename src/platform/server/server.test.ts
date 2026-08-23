import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "./server.js";
import { createLogger } from "../logger/logger.js";

describe("server", () => {
  const logger = createLogger("silent");
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({
      host: "127.0.0.1",
      port: 0,
      logger,
      readinessChecks: [
        { name: "db", check: async () => true },
        { name: "s3", check: async () => true },
      ],
    });
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.versions).toBeDefined();
      expect(body.versions.grammar).toBeTruthy();
      expect(body.versions.resolver).toBeTruthy();
      expect(body.versions.extractor).toBeTruthy();
      expect(body.versions.anchorer).toBeTruthy();
    });

    it("returns a correlation ID header", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.headers["x-correlation-id"]).toBeDefined();
    });

    it("echoes a provided correlation ID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { "x-correlation-id": "custom-id-abc" },
      });
      expect(res.headers["x-correlation-id"]).toBe("custom-id-abc");
    });
  });

  describe("GET /ready", () => {
    it("returns 200 when all checks pass", async () => {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ready");
      expect(body.details).toEqual({ db: true, s3: true });
    });
  });

  describe("GET /ready with failing checks", () => {
    it("returns 503 when a check fails", async () => {
      const failApp = await createServer({
        host: "127.0.0.1",
        port: 0,
        logger,
        readinessChecks: [
          { name: "db", check: async () => true },
          { name: "s3", check: async () => false },
        ],
      });

      const res = await failApp.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe("not_ready");
      expect(body.details).toEqual({ db: true, s3: false });

      await failApp.close();
    });

    it("returns 503 when a check throws", async () => {
      const throwApp = await createServer({
        host: "127.0.0.1",
        port: 0,
        logger,
        readinessChecks: [
          {
            name: "db",
            check: async () => {
              throw new Error("connection refused");
            },
          },
        ],
      });

      const res = await throwApp.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(503);

      await throwApp.close();
    });
  });
});
