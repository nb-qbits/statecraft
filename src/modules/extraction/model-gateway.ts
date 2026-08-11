import type { PromptHash, ModelCallId } from "../shared/types.js";

export interface ModelRequest {
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly promptHash: PromptHash;
  readonly responseSchema: Record<string, unknown>;
  readonly correlationId: string;
}

export interface ModelResponse {
  readonly modelCallId: ModelCallId;
  readonly modelId: string;
  readonly promptHash: PromptHash;
  readonly requestPayload: string;
  readonly responsePayload: string;
  readonly parsedContent: unknown;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly correlationId: string;
}

export interface ModelGateway {
  call(request: ModelRequest): Promise<ModelResponse>;
}
