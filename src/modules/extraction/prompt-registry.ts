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

A temporal obligation is a span that states a time by which a DUTY must be performed — a filing, a report, a submission, an action someone is required to take. Extract only these.

For each segment, identify spans of text that represent:
- obligation_deadline: a specific date or duration by which a duty must be performed
- effective_date: when the act or section takes effect
- duration: a time period creating a deadline for action (e.g., "within 30 days", "no later than August 1")
- temporal_constraint: a recurring schedule for a required action (e.g., "annually", "quarterly")

DO NOT extract:
- Terms of office or appointment durations ("five-year staggered terms", "term coincident with his term of office", "for the unexpired term", "more than two consecutive terms")
- Backward-looking time references ("in the prior year", "over the next two years")
- Sub-clauses within an obligation that are not themselves deadlines ("with any feedback from the Bank Advisory Board incorporated therein")
- Temporal language describing a precondition or context rather than a duty ("prior to adoption of the strategic plan")
- Schedule descriptions that do not impose a duty on anyone

RULES:
1. Return ONLY quoted text that appears verbatim in the segment. Do not paraphrase.
2. Do NOT return dates, computed values, or normalized forms. Return only the quoted span.
3. Each proposal must include the segmentId, the exact quotedText, and the kind.
4. If no temporal obligations exist in the segment, return an empty proposals array.
5. Quote the minimal span that captures the complete temporal expression.
6. For each proposal, identify the accountable party — the person, entity, department, or body that bears the obligation. Set:
   - actorQuotedText: the exact text from the segment that names the actor (quoted verbatim, minimal span)
   - actor: the shortest unambiguous name for the actor as it actually appears in the segment text. Use the name the segment uses — do not expand abbreviations or invent a formal name not present in the text. For example, if the segment says "the Bank", set actor to "Bank" (drop the article). If the segment says "the Department of Energy", set actor to "Department of Energy".
   If no actor is stated or inferable from the segment, set both to null.
7. For each proposal, check whether it explicitly references the completion or output of another obligation in the same segment — signalled by language like "following adoption of", "after submission of", "with feedback incorporated", "prior to". If so, set:
   - dependsOnQuotedText: the exact text from the segment that states the dependency relationship (quoted verbatim, minimal span)
   - dependsOnDescription: a brief description of what this obligation depends on (e.g., "draft plan submitted to Advisory Board")
   If no dependency language is present, set both to null. Textual proximity is not dependency — only explicit language stating that one duty depends on another's completion.`;

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
