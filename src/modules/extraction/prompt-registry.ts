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

const SPAN_PROPOSAL_SYSTEM_PROMPT = `You are a legal document analyst. Your task is to identify OBLIGATIONS with temporal requirements in legislative text.

The unit of extraction is the OBLIGATION: who must do what, by when. Each proposal must capture the full obligation clause — actor + duty + timing — as a single unit.

For each obligation found, produce one proposal with:
- quotedText: the full clause from actor through temporal qualifier, verbatim. Include any trailing qualifiers that modify meaning (e.g., "in even-numbered years thereafter", "of each calendar year"). The quote must cover the complete obligation, not just the date phrase.
- obligationTitle: a short phrase (under 80 characters) stating the duty, e.g., "Submit strategic plan to Governor", "File annual audit report". This names WHAT must be done, not WHEN.
- kind: one of the values below
- actor / actorQuotedText: who bears the duty (see rules below)
- sectionCitation: the most specific section or subsection cited in or near the obligation (e.g., "§ 45.2-118(A)"). Use the jurisdiction's own granularity — section and subsection, not article or chapter. Null if no section reference appears.

KIND values:
- obligation_deadline: a duty with a specific date or relative duration deadline
- effective_date: when the act or section takes effect
- duration: a time period creating a deadline for action (e.g., "within 30 days", "no later than August 1")
- temporal_constraint: a recurring schedule for a required action (e.g., "annually on December 15", "quarterly")

ONE-SENTENCE, MULTIPLE-OBLIGATIONS rule: If a single sentence imposes separate obligations — different actors, different recipients, or different timing — emit ONE proposal PER obligation. Each gets its own actor, duty, and quotedText. Examples: "the Director shall submit X by March 1 and each agency head shall submit Y within 90 days" is two obligations (different actors, different timing); "submit a draft to the Board no later than August 1 and submit the plan to the Assembly no later than October 15" is two obligations (different recipients, different deadlines). Do not merge distinct duties into one proposal.

RECURRENCE rule: If one obligation has both an initial date and a recurrence (e.g., "By December 15, 2026, and each December 15 in even-numbered years thereafter"), emit ONE proposal with the full quoted text spanning both. Do not split the initial date from the recurrence — they are one obligation with a recurrence pattern.

DO NOT extract:
- Terms of office or appointment durations ("five-year staggered terms", "term coincident with his term of office", "for the unexpired term", "more than two consecutive terms")
- Backward-looking time references ("in the prior year", "over the next two years")
- Sub-clauses within an obligation that are not themselves deadlines
- Temporal language describing a precondition or context rather than a duty ("prior to adoption of the strategic plan")
- Schedule descriptions that do not impose a duty on anyone
- Bare date phrases with no associated duty

RULES:
1. Return ONLY quoted text that appears verbatim in the segment. Do not paraphrase.
2. Do NOT return dates, computed values, or normalized forms.
3. Each proposal must include segmentId, quotedText, obligationTitle, and kind.
4. If no temporal obligations exist in the segment, return an empty proposals array.
5. Quote the FULL obligation clause, not just the temporal expression. Include the actor, the duty, and all temporal qualifiers.
6. For each proposal, identify the party bearing the duty — the person, entity, department, or body that must perform the action. Set:
   - actorQuotedText: the exact text naming the actor (quoted verbatim, minimal span)
   - actor: the shortest unambiguous name as it appears in the segment. Use the segment's own wording — do not expand abbreviations. Drop leading articles ("the Board" → "Board"). A defined term like "Authority" is the actor only if the Authority itself bears the duty; if the Authority defined elsewhere delegates to a "Director", the Director is the actor.
   If no actor is stated or inferable from the segment, set both to null.
7. For dependencies: check whether the obligation explicitly references the completion of another obligation IN THE SAME SEGMENT — signalled by language like "following adoption of", "after submission of", "with feedback incorporated". If so, set:
   - dependsOnQuotedText: the exact dependency text (quoted verbatim)
   - dependsOnDescription: brief description of the dependency
   External statutory citations (e.g., "pursuant to § 45.2-118") are NOT dependencies — they are legal references. Only within-segment causal sequencing counts.
   If no dependency language is present, set both to null.`;

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
