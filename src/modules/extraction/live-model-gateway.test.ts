import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLiveModelGateway } from "./live-model-gateway.js";
import type { ModelRequest } from "./model-gateway.js";
import type { PromptHash } from "../shared/types.js";

const REQUEST: ModelRequest = {
  modelId: "test-model",
  systemPrompt: "You are a test assistant.",
  userPrompt: "Extract temporal obligations.",
  promptHash: "ph_abc123" as PromptHash,
  responseSchema: {
    type: "object",
    properties: { proposals: { type: "array", items: { type: "object" } } },
    required: ["proposals"],
  },
  correlationId: "test_001",
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Anthropic live gateway", () => {
  it("shapes the request correctly for Anthropic Messages API", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url as string;
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string>),
      );
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "extraction_result",
              input: { proposals: [{ segmentId: "seg_1", quotedText: "within 30 days", kind: "duration" }] },
            },
          ],
          usage: { input_tokens: 150, output_tokens: 42 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({
      provider: "anthropic",
      apiKey: "sk-ant-test-key",
    });

    const res = await gw.call(REQUEST);

    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test-key");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedBody["model"]).toBe("test-model");
    expect(capturedBody["system"]).toBe("You are a test assistant.");
    expect(capturedBody["messages"]).toEqual([
      { role: "user", content: "Extract temporal obligations." },
    ]);
    expect(capturedBody["tools"]).toBeDefined();
    expect(capturedBody["tool_choice"]).toEqual({ type: "tool", name: "extraction_result" });

    expect(res.modelCallId).toMatch(/^mcall_/);
    expect(res.modelId).toBe("test-model");
    expect(res.promptHash).toBe("ph_abc123");
    expect(res.inputTokens).toBe(150);
    expect(res.outputTokens).toBe(42);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.correlationId).toBe("test_001");

    const parsed = res.parsedContent as { proposals: Array<{ quotedText: string }> };
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]!.quotedText).toBe("within 30 days");
  });

  it("uses custom base URL when provided", async () => {
    let capturedUrl = "";

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = url as string;
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", id: "tu_1", name: "extraction_result", input: { proposals: [] } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({
      provider: "anthropic",
      apiKey: "key",
      baseUrl: "https://custom-proxy.example.com",
    });

    await gw.call(REQUEST);
    expect(capturedUrl).toBe("https://custom-proxy.example.com/v1/messages");
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('{"error":{"message":"bad key"}}', { status: 401 });
    }) as typeof fetch;

    const gw = createLiveModelGateway({ provider: "anthropic", apiKey: "bad" });
    await expect(gw.call(REQUEST)).rejects.toThrow("Anthropic API 401");
  });

  it("throws when response has no tool_use block", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "I cannot do that." }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({ provider: "anthropic", apiKey: "key" });
    await expect(gw.call(REQUEST)).rejects.toThrow("no tool_use block");
  });
});

describe("OpenAI live gateway", () => {
  it("shapes the request correctly for Chat Completions API", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url as string;
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string>),
      );
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  proposals: [{ segmentId: "seg_1", quotedText: "July 1, 2026", kind: "effective_date" }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 30 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({
      provider: "openai",
      apiKey: "sk-openai-test",
    });

    const res = await gw.call(REQUEST);

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedHeaders["authorization"]).toBe("Bearer sk-openai-test");
    expect(capturedBody["model"]).toBe("test-model");
    expect(capturedBody["messages"]).toEqual([
      { role: "system", content: "You are a test assistant." },
      { role: "user", content: "Extract temporal obligations." },
    ]);
    expect(capturedBody["response_format"]).toEqual({
      type: "json_schema",
      json_schema: {
        name: "extraction_result",
        schema: REQUEST.responseSchema,
        strict: true,
      },
    });

    expect(res.inputTokens).toBe(200);
    expect(res.outputTokens).toBe(30);

    const parsed = res.parsedContent as { proposals: Array<{ quotedText: string }> };
    expect(parsed.proposals[0]!.quotedText).toBe("July 1, 2026");
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('{"error":{"message":"rate limited"}}', { status: 429 });
    }) as typeof fetch;

    const gw = createLiveModelGateway({ provider: "openai", apiKey: "bad" });
    await expect(gw.call(REQUEST)).rejects.toThrow("OpenAI API 429");
  });

  it("throws on invalid JSON in response content", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "not json at all" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({ provider: "openai", apiKey: "key" });
    await expect(gw.call(REQUEST)).rejects.toThrow("not valid JSON");
  });
});

describe("provider selection", () => {
  it("strips trailing slashes from base URL", async () => {
    let capturedUrl = "";

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = url as string;
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", id: "tu_1", name: "extraction_result", input: { proposals: [] } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const gw = createLiveModelGateway({
      provider: "anthropic",
      apiKey: "key",
      baseUrl: "https://proxy.example.com///",
    });

    await gw.call(REQUEST);
    expect(capturedUrl).toBe("https://proxy.example.com/v1/messages");
  });
});
