import type { AnchorId, SegmentId, EvaluatorVerdict, PromptHash } from "../shared/types.js";
import type { ModelGateway } from "../extraction/model-gateway.js";
import { renderUserPrompt } from "../extraction/prompt-registry.js";
import { SUPPORT_EVALUATION_PROMPT } from "./evaluator-prompt.js";

const EVALUATOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["ambiguous", "unsupported"] },
    reasoning: { type: "string" },
  },
  required: ["verdict", "reasoning"],
  additionalProperties: false,
} as const;

const VALID_VERDICTS = new Set<string>(["ambiguous", "unsupported"]);

export interface EvaluatorInput {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly kind: string;
  readonly quotedText: string;
  readonly segmentText: string;
}

export interface EvaluatorOutput {
  readonly verdict: EvaluatorVerdict;
  readonly reasoning: string;
  readonly promptHash: PromptHash;
}

export interface SupportEvaluator {
  evaluate(input: EvaluatorInput): Promise<EvaluatorOutput>;
  readonly promptHash: PromptHash;
}

export function createSupportEvaluator(
  modelGateway: ModelGateway,
  modelId: string,
): SupportEvaluator {
  const prompt = SUPPORT_EVALUATION_PROMPT;

  return {
    promptHash: prompt.promptHash,

    async evaluate(input: EvaluatorInput): Promise<EvaluatorOutput> {
      const userPrompt = renderUserPrompt(prompt.userTemplate, {
        segmentId: input.segmentId,
        anchorId: input.anchorId,
        kind: input.kind,
        quotedText: input.quotedText,
        segmentText: input.segmentText,
      });

      const response = await modelGateway.call({
        modelId,
        systemPrompt: prompt.systemPrompt,
        userPrompt,
        promptHash: prompt.promptHash,
        responseSchema: EVALUATOR_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        correlationId: `eval_${input.anchorId}`,
      });

      const parsed = response.parsedContent as {
        verdict: string;
        reasoning: string;
      };

      if (!VALID_VERDICTS.has(parsed.verdict)) {
        return {
          verdict: "unsupported" as EvaluatorVerdict,
          reasoning: `evaluator returned invalid verdict "${parsed.verdict}" — forced to unsupported`,
          promptHash: prompt.promptHash,
        };
      }

      return {
        verdict: parsed.verdict as EvaluatorVerdict,
        reasoning: parsed.reasoning,
        promptHash: prompt.promptHash,
      };
    },
  };
}
