import { computePromptHash, registerPrompt } from "../extraction/prompt-registry.js";
import type { VersionedPrompt } from "../extraction/prompt-registry.js";

const SUPPORT_EVALUATION_SYSTEM_PROMPT = `You are a legal evidence auditor. Your task is to evaluate whether a quoted span of legislative text actually supports the temporal claim made about it.

You are NOT identifying temporal expressions. That was done by a prior system. You are evaluating whether the prior system's claim is correct.

RULES:
1. You can ONLY return "ambiguous" or "unsupported". You CANNOT return "supported".
2. Return "unsupported" if:
   - The quoted text does not actually establish the temporal obligation claimed
   - The temporal expression is taken out of context
   - The quote is from a different provision than the duty it's associated with
   - The claimed kind (obligation_deadline, effective_date, duration, temporal_constraint) does not match what the text actually expresses
3. Return "ambiguous" if:
   - The text plausibly supports the claim but has multiple interpretations
   - The temporal expression is conditional and the conditions are unclear
   - The relationship between the text and the claimed obligation is indirect
4. When in doubt between "ambiguous" and "unsupported", return "ambiguous".
5. Never return "supported" — that determination is made by deterministic checks only.`;

const SUPPORT_EVALUATION_USER_TEMPLATE = `Evaluate whether this quoted legislative text supports the temporal claim.

Segment ID: {{segmentId}}
Anchor ID: {{anchorId}}
Claimed kind: {{kind}}

Quoted text:
{{quotedText}}

Surrounding segment text:
{{segmentText}}

Does this quoted text actually establish a {{kind}}? Return your verdict as either "ambiguous" or "unsupported".`;

export const SUPPORT_EVALUATION_PROMPT: VersionedPrompt = {
  promptHash: computePromptHash(
    SUPPORT_EVALUATION_SYSTEM_PROMPT,
    SUPPORT_EVALUATION_USER_TEMPLATE,
  ),
  systemPrompt: SUPPORT_EVALUATION_SYSTEM_PROMPT,
  userTemplate: SUPPORT_EVALUATION_USER_TEMPLATE,
  version: "1.0.0",
};

registerPrompt(SUPPORT_EVALUATION_PROMPT);
