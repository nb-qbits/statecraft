import { describe, it, expect } from "vitest";
import type { PromptHash } from "../shared/types.js";
import { createFixtureModelGateway } from "./fixture-model-gateway.js";
import type { ModelRequest } from "./model-gateway.js";

const PROMPT_HASH = "ph_abc123" as PromptHash;

function makeRequest(userPrompt: string): ModelRequest {
  return {
    modelId: "test-model",
    systemPrompt: "system",
    userPrompt,
    promptHash: PROMPT_HASH,
    responseSchema: {},
    correlationId: "corr-1",
  };
}

describe("fixture-model-gateway", () => {
  it("returns matching fixture for known prompt", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "some legislative text",
        responsePayload: JSON.stringify({ proposals: [] }),
        parsedContent: { proposals: [] },
      },
    ]);

    const response = await gateway.call(makeRequest("some legislative text"));
    expect(response.modelId).toBe("test-model");
    expect(response.promptHash).toBe(PROMPT_HASH);
    expect(response.parsedContent).toEqual({ proposals: [] });
    expect(response.latencyMs).toBe(0);
  });

  it("returns a response with proper ModelCallId", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "text",
        responsePayload: "{}",
        parsedContent: {},
      },
    ]);

    const response = await gateway.call(makeRequest("text"));
    expect(response.modelCallId).toMatch(/^mcall_[0-9a-f]{32}$/);
  });

  it("records correct token counts from fixture", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "text",
        responsePayload: "{}",
        parsedContent: {},
        inputTokens: 200,
        outputTokens: 75,
      },
    ]);

    const response = await gateway.call(makeRequest("text"));
    expect(response.inputTokens).toBe(200);
    expect(response.outputTokens).toBe(75);
  });

  it("falls back to last fixture when prompt not matched", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "alpha segment",
        responsePayload: JSON.stringify({ proposals: [{ segmentId: "seg_1", quotedText: "first", kind: "duration" }] }),
        parsedContent: { proposals: [{ segmentId: "seg_1", quotedText: "first", kind: "duration" }] },
      },
      {
        promptHash: PROMPT_HASH,
        segmentText: "__fallback__",
        responsePayload: JSON.stringify({ proposals: [] }),
        parsedContent: { proposals: [] },
      },
    ]);

    const response = await gateway.call(makeRequest("no match here"));
    expect(response.parsedContent).toEqual({ proposals: [] });
  });

  it("throws when no fixtures at all", async () => {
    const gateway = createFixtureModelGateway([]);
    await expect(gateway.call(makeRequest("anything"))).rejects.toThrow(
      "no fixture found",
    );
  });

  it("preserves correlationId from request", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "text",
        responsePayload: "{}",
        parsedContent: {},
      },
    ]);

    const response = await gateway.call({
      ...makeRequest("text"),
      correlationId: "my-correlation",
    });
    expect(response.correlationId).toBe("my-correlation");
  });

  it("serializes request payload", async () => {
    const gateway = createFixtureModelGateway([
      {
        promptHash: PROMPT_HASH,
        segmentText: "text",
        responsePayload: "{}",
        parsedContent: {},
      },
    ]);

    const response = await gateway.call(makeRequest("text"));
    const payload = JSON.parse(response.requestPayload);
    expect(payload.model).toBe("test-model");
    expect(payload.system).toBe("system");
    expect(payload.user).toBe("text");
  });
});
