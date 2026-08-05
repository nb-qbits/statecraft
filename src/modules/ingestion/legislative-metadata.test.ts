import { describe, it, expect } from "vitest";
import { createNullMetadataSource } from "./legislative-metadata.js";

describe("createNullMetadataSource", () => {
  it("returns null for any lookup", async () => {
    const source = createNullMetadataSource();
    const result = await source.lookup({
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "1234",
      stage: "introduced",
      chapter: null,
    });
    expect(result).toBeNull();
  });

  it("has provider name 'none'", () => {
    const source = createNullMetadataSource();
    expect(source.provider).toBe("none");
  });
});
