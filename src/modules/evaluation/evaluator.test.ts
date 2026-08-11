import { describe, it, expect, vi } from "vitest";
import type {
  AnchorId,
  SegmentId,
  EvaluatorVerdict,
  ModelCallId,
} from "../shared/types.js";
import type { ModelGateway, ModelRequest, ModelResponse } from "../extraction/model-gateway.js";
import { createSupportEvaluator } from "./evaluator.js";
import { SUPPORT_EVALUATION_PROMPT } from "./evaluator-prompt.js";

function makeGatewayResponse(
  verdict: string,
  reasoning: string,
): ModelGateway {
  const callFn = vi.fn(async (request: ModelRequest): Promise<ModelResponse> => ({
    modelCallId: "mcall_test" as ModelCallId,
    modelId: request.modelId,
    promptHash: request.promptHash,
    requestPayload: "{}",
    responsePayload: JSON.stringify({ verdict, reasoning }),
    parsedContent: { verdict, reasoning },
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 0,
    correlationId: request.correlationId,
  }));
  return { call: callFn };
}

describe("Support Evaluator", () => {
  it("returns ambiguous when model says ambiguous", async () => {
    const gateway = makeGatewayResponse("ambiguous", "multiple interpretations possible");
    const evaluator = createSupportEvaluator(gateway, "test-model");

    const result = await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "duration",
      quotedText: "within 30 days",
      segmentText: "shall report within 30 days of placement",
    });

    expect(result.verdict).toBe("ambiguous");
    expect(result.reasoning).toBe("multiple interpretations possible");
    expect(result.promptHash).toBe(SUPPORT_EVALUATION_PROMPT.promptHash);
  });

  it("returns unsupported when model says unsupported", async () => {
    const gateway = makeGatewayResponse("unsupported", "text does not establish deadline");
    const evaluator = createSupportEvaluator(gateway, "test-model");

    const result = await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "obligation_deadline",
      quotedText: "sometime next year",
      segmentText: "shall convene sometime next year",
    });

    expect(result.verdict).toBe("unsupported");
  });

  it("forces unsupported when model returns an invalid verdict", async () => {
    const gateway = makeGatewayResponse("supported", "looks good to me");
    const evaluator = createSupportEvaluator(gateway, "test-model");

    const result = await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "duration",
      quotedText: "within 30 days",
      segmentText: "shall report within 30 days of placement",
    });

    expect(result.verdict).toBe("unsupported");
    expect(result.reasoning).toContain("invalid verdict");
    expect(result.reasoning).toContain("supported");
  });

  it("forces unsupported when model returns any other string", async () => {
    const gateway = makeGatewayResponse("approved", "this is fine");
    const evaluator = createSupportEvaluator(gateway, "test-model");

    const result = await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "duration",
      quotedText: "within 30 days",
      segmentText: "shall report within 30 days of placement",
    });

    expect(result.verdict).toBe("unsupported");
  });

  it("uses a different prompt hash than the extraction prompt", async () => {
    const gateway = makeGatewayResponse("ambiguous", "residual check");
    const evaluator = createSupportEvaluator(gateway, "test-model");

    await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "duration",
      quotedText: "within 30 days",
      segmentText: "shall report within 30 days of placement",
    });

    const callArgs = (gateway.call as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as ModelRequest;
    expect(callArgs.promptHash).toBe(SUPPORT_EVALUATION_PROMPT.promptHash);
    expect(callArgs.promptHash).not.toBe("ph_fixture");
  });

  it("uses the specified model ID, not the extraction model", async () => {
    const gateway = makeGatewayResponse("ambiguous", "test");
    const evaluator = createSupportEvaluator(gateway, "evaluator-model-v2");

    await evaluator.evaluate({
      anchorId: "anc_test" as AnchorId,
      segmentId: "seg_test" as SegmentId,
      kind: "duration",
      quotedText: "test",
      segmentText: "test segment",
    });

    const callArgs = (gateway.call as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as ModelRequest;
    expect(callArgs.modelId).toBe("evaluator-model-v2");
  });

  // INV-4: EvaluatorVerdict type has no "supported" variant.
  // This compile-time test ensures the type system enforces INV-4.
  it("EvaluatorVerdict type excludes 'supported' — INV-4 compile-time enforcement", () => {
    // @ts-expect-error — "supported" is not assignable to EvaluatorVerdict
    const _forbidden: EvaluatorVerdict = "supported";

    const valid1: EvaluatorVerdict = "ambiguous";
    const valid2: EvaluatorVerdict = "unsupported";
    expect(valid1).toBe("ambiguous");
    expect(valid2).toBe("unsupported");
  });
});
