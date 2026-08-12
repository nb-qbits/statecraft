import { createHash, randomUUID } from "node:crypto";
import type { ModelCallId } from "../shared/types.js";
import type { ModelGateway, ModelRequest, ModelResponse } from "./model-gateway.js";

export type ModelProvider = "anthropic" | "openai";

export interface LiveModelGatewayConfig {
  readonly provider: ModelProvider;
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
}

const DEFAULT_BASE_URLS: Record<ModelProvider, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
};

export function createLiveModelGateway(
  config: LiveModelGatewayConfig,
): ModelGateway {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URLS[config.provider]).replace(/\/+$/, "");

  if (config.provider === "anthropic") {
    return createAnthropicGateway(config.apiKey, baseUrl);
  }
  return createOpenAIGateway(config.apiKey, baseUrl);
}

function makeCallId(): ModelCallId {
  return `mcall_${createHash("sha256").update(randomUUID()).digest("hex").slice(0, 32)}` as ModelCallId;
}

function createAnthropicGateway(apiKey: string, baseUrl: string): ModelGateway {
  return {
    async call(request: ModelRequest): Promise<ModelResponse> {
      const requestBody = {
        model: request.modelId,
        max_tokens: 4096,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userPrompt }],
        tools: [
          {
            name: "extraction_result",
            description: "Return the extraction results as structured data.",
            input_schema: request.responseSchema,
          },
        ],
        tool_choice: { type: "tool", name: "extraction_result" },
      };

      const requestPayload = JSON.stringify(requestBody);
      const start = performance.now();

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: requestPayload,
      });

      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      const json = (await res.json()) as AnthropicResponse;
      const toolBlock = json.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("Anthropic response contained no tool_use block");
      }

      const parsedContent = toolBlock.input;
      const responsePayload = JSON.stringify(parsedContent);

      return {
        modelCallId: makeCallId(),
        modelId: request.modelId,
        promptHash: request.promptHash,
        requestPayload,
        responsePayload,
        parsedContent,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        latencyMs,
        correlationId: request.correlationId,
      };
    },
  };
}

function createOpenAIGateway(apiKey: string, baseUrl: string): ModelGateway {
  return {
    async call(request: ModelRequest): Promise<ModelResponse> {
      const requestBody = {
        model: request.modelId,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "extraction_result",
            schema: request.responseSchema,
            strict: true,
          },
        },
      };

      const requestPayload = JSON.stringify(requestBody);
      const start = performance.now();

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: requestPayload,
      });

      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${text}`);
      }

      const json = (await res.json()) as OpenAIResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenAI response contained no message content");
      }

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        throw new Error(`OpenAI response is not valid JSON: ${content.slice(0, 200)}`);
      }

      return {
        modelCallId: makeCallId(),
        modelId: request.modelId,
        promptHash: request.promptHash,
        requestPayload,
        responsePayload: content,
        parsedContent,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        latencyMs,
        correlationId: request.correlationId,
      };
    },
  };
}

interface AnthropicResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  usage?: { input_tokens: number; output_tokens: number };
}

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}
