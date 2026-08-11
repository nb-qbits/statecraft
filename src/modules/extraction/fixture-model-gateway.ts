import { createHash, randomUUID } from "node:crypto";
import type { ModelCallId, PromptHash } from "../shared/types.js";
import type { ModelGateway, ModelRequest, ModelResponse } from "./model-gateway.js";

export interface FixtureEntry {
  readonly promptHash: PromptHash;
  readonly segmentText: string;
  readonly responsePayload: string;
  readonly parsedContent: unknown;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export function createFixtureModelGateway(
  fixtures: readonly FixtureEntry[],
): ModelGateway {
  return {
    async call(request: ModelRequest): Promise<ModelResponse> {
      for (const f of fixtures) {
        if (request.userPrompt.includes(f.segmentText)) {
          return makeResponse(request, f);
        }
      }
      const fallback = fixtures.at(-1);
      if (!fallback) {
        throw new Error(
          `FixtureModelGateway: no fixture found for prompt (length=${request.userPrompt.length})`,
        );
      }
      return makeResponse(request, fallback);
    },
  };
}

function makeResponse(request: ModelRequest, fixture: FixtureEntry): ModelResponse {
  const callId = `mcall_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 32)}` as ModelCallId;
  return {
    modelCallId: callId,
    modelId: request.modelId,
    promptHash: request.promptHash,
    requestPayload: JSON.stringify({
      model: request.modelId,
      system: request.systemPrompt,
      user: request.userPrompt,
      response_format: request.responseSchema,
    }),
    responsePayload: fixture.responsePayload,
    parsedContent: fixture.parsedContent,
    inputTokens: fixture.inputTokens ?? 100,
    outputTokens: fixture.outputTokens ?? 50,
    latencyMs: 0,
    correlationId: request.correlationId,
  };
}
