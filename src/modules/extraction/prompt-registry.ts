import { createHash } from "node:crypto";
import type { PromptHash } from "../shared/types.js";

export interface VersionedPrompt {
  readonly promptHash: PromptHash;
  readonly systemPrompt: string;
  readonly userTemplate: string;
  readonly version: string;
}

export function computePromptHash(systemPrompt: string, userTemplate: string): PromptHash {
  const input = `${systemPrompt}\n---\n${userTemplate}`;
  const hash = createHash("sha256").update(input).digest("hex");
  return `ph_${hash}` as PromptHash;
}

const SPAN_PROPOSAL_SYSTEM_PROMPT = `You are a legal document analyst. Your task is to identify temporal obligations in legislative text.

For each segment, identify spans of text that represent:
- obligation_deadline: a specific date or duration that creates a legal deadline
- effective_date: when the act or section takes effect
- duration: a time period (e.g., "within 30 days", "two business days")
- temporal_constraint: a temporal reference tying an obligation to an event

RULES:
1. Return ONLY quoted text that appears verbatim in the segment. Do not paraphrase.
2. Do NOT return dates, computed values, or normalized forms. Return only the quoted span.
3. Each proposal must include the segmentId, the exact quotedText, and the kind.
4. If no temporal obligations exist in the segment, return an empty proposals array.
5. Quote the minimal span that captures the complete temporal expression.`;

const SPAN_PROPOSAL_USER_TEMPLATE = `Analyze this legislative segment for temporal obligations.

Segment ID: {{segmentId}}
Candidates found: {{candidateSummary}}

Text:
{{normalizedText}}`;

export const SPAN_PROPOSAL_PROMPT: VersionedPrompt = {
  promptHash: computePromptHash(SPAN_PROPOSAL_SYSTEM_PROMPT, SPAN_PROPOSAL_USER_TEMPLATE),
  systemPrompt: SPAN_PROPOSAL_SYSTEM_PROMPT,
  userTemplate: SPAN_PROPOSAL_USER_TEMPLATE,
  version: "1.0.0",
};

export function renderUserPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

const prompts = new Map<string, VersionedPrompt>();
prompts.set(SPAN_PROPOSAL_PROMPT.promptHash, SPAN_PROPOSAL_PROMPT);

export function getPromptByHash(hash: PromptHash): VersionedPrompt | undefined {
  return prompts.get(hash);
}

export function registerPrompt(prompt: VersionedPrompt): void {
  prompts.set(prompt.promptHash, prompt);
}
