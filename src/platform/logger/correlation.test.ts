import { describe, it, expect } from "vitest";
import {
  runWithCorrelation,
  getCorrelationId,
  newCorrelationId,
} from "./correlation.js";

describe("correlation", () => {
  it("returns undefined outside of a correlation context", () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it("returns the correlation ID inside a context", () => {
    runWithCorrelation("abc-123", () => {
      expect(getCorrelationId()).toBe("abc-123");
    });
  });

  it("nests contexts correctly", () => {
    runWithCorrelation("outer", () => {
      expect(getCorrelationId()).toBe("outer");
      runWithCorrelation("inner", () => {
        expect(getCorrelationId()).toBe("inner");
      });
      expect(getCorrelationId()).toBe("outer");
    });
  });

  it("generates unique correlation IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newCorrelationId()));
    expect(ids.size).toBe(100);
  });

  it("generated IDs are valid UUIDs", () => {
    const id = newCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
