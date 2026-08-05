import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenStatesSource } from "./openstates.js";
import { createLogger } from "../logger/logger.js";

const logger = createLogger("silent");

describe("createOpenStatesSource", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has provider name 'openstates'", () => {
    const source = createOpenStatesSource("test-key", logger);
    expect(source.provider).toBe("openstates");
  });

  it("derives enacted status from executive-signature action", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "ocd-bill/123",
            identifier: "HB 1234",
            title: "Test Bill",
            latest_action_date: "2025-04-01",
            latest_action_description: "Signed by Governor",
            openstates_url: "https://openstates.org/va/bills/2025/HB1234",
            actions: [
              {
                description: "Introduced",
                date: "2025-01-15",
                classification: ["introduction"],
              },
              {
                description: "Signed by Governor",
                date: "2025-04-01",
                classification: ["executive-signature"],
              },
            ],
          },
        ],
      }),
    }) as typeof fetch;

    const source = createOpenStatesSource("test-key", logger);
    const result = await source.lookup({
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "1234",
      stage: "introduced",
      chapter: null,
    });

    expect(result).not.toBeNull();
    expect(result!.legislativeStatus).toBe("enacted");
    expect(result!.authoritativeSource).toBe(
      "https://openstates.org/va/bills/2025/HB1234",
    );
  });

  it("derives vetoed status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "ocd-bill/456",
            identifier: "SB 100",
            title: "Test",
            latest_action_date: "2025-05-01",
            latest_action_description: "Vetoed",
            openstates_url: "https://openstates.org/va/bills/2025/SB100",
            actions: [
              {
                description: "Vetoed by Governor",
                date: "2025-05-01",
                classification: ["executive-veto"],
              },
            ],
          },
        ],
      }),
    }) as typeof fetch;

    const source = createOpenStatesSource("test-key", logger);
    const result = await source.lookup({
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "SB",
      number: "100",
      stage: "introduced",
      chapter: null,
    });

    expect(result!.legislativeStatus).toBe("vetoed");
  });

  it("returns null when no bill found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as typeof fetch;

    const source = createOpenStatesSource("test-key", logger);
    const result = await source.lookup({
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "9999",
      stage: "introduced",
      chapter: null,
    });

    expect(result).toBeNull();
  });

  it("returns null when API returns error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as typeof fetch;

    const source = createOpenStatesSource("bad-key", logger);
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

  it("returns null when fetch throws (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED"),
    ) as typeof fetch;

    const source = createOpenStatesSource("test-key", logger);
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

  it("sends API key in X-API-KEY header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const source = createOpenStatesSource("my-secret-key", logger);
    await source.lookup({
      jurisdiction: "Virginia",
      session: "2025",
      instrumentType: "HB",
      number: "1234",
      stage: "introduced",
      chapter: null,
    });

    const callArgs = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = callArgs![1].headers;
    expect(headers["X-API-KEY"]).toBe("my-secret-key");
  });
});
