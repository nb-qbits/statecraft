import { CandidateKind } from "./types.js";
import type { ScanRule } from "./types.js";

export const SCAN_RULES: readonly ScanRule[] = [
  {
    ruleId: "suppress.history_line",
    kind: CandidateKind.date,
    pattern: /^\d{4},\s+c\.\s+\d+(?:;\s*\d{4},\s+c\.\s+\d+)*\.?\s*$/,
    isSuppression: true,
  },
  {
    ruleId: "suppress.metadata_header",
    kind: CandidateKind.date,
    pattern: /(?:Offered|Prefiled)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/gi,
    isSuppression: true,
  },

  {
    ruleId: "date.explicit_month_day_year",
    kind: CandidateKind.date,
    pattern:
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "date.explicit_mdy_numeric",
    kind: CandidateKind.date,
    pattern: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    isSuppression: false,
  },

  {
    ruleId: "duration.within_n_unit",
    kind: CandidateKind.duration,
    pattern:
      /\bwithin\s+(?:\d+|[a-z]+(?:-[a-z]+)*)\s+(?:calendar\s+|business\s+|work(?:ing)?\s+)?days?\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "duration.n_unit",
    kind: CandidateKind.duration,
    pattern:
      /(?:^|(?<=\s))(?:an\s+additional\s+)?(?:\d+|[a-z]+(?:-[a-z]+)*)\s+(?:calendar\s+|business\s+|work(?:ing)?\s+)days?\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "duration.hyphenated",
    kind: CandidateKind.duration,
    pattern: /\b[a-z]+-(?:work(?:ing)?-)?day\s+period\b/gi,
    isSuppression: false,
  },

  {
    ruleId: "temporal.effective_date_ref",
    kind: CandidateKind.temporal_connector,
    pattern:
      /\b(?:the\s+)?effective\s+date(?:\s+(?:of\s+this\s+act|hereof))?\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "temporal.enactment_ref",
    kind: CandidateKind.temporal_connector,
    pattern:
      /\b(?:upon\s+enactment|from\s+passage|(?:from\s+)?the\s+date\s+of\s+enactment)\b/gi,
    isSuppression: false,
  },

  {
    ruleId: "modal.shall",
    kind: CandidateKind.modal_verb,
    pattern: /\bshall\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "modal.may",
    kind: CandidateKind.modal_verb,
    pattern: /\bmay\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "modal.authorized",
    kind: CandidateKind.modal_verb,
    pattern: /\bis\s+authorized\s+to\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "modal.shall_endeavor",
    kind: CandidateKind.modal_verb,
    pattern: /\bshall\s+endeavor\b/gi,
    isSuppression: false,
  },

  {
    ruleId: "citation.section_symbol",
    kind: CandidateKind.citation,
    pattern: /§\s*[\d]+(?:[.\-:][\d\w()]+)*/g,
    isSuppression: false,
  },

  {
    ruleId: "enactment.clause",
    kind: CandidateKind.enactment_clause,
    pattern:
      /\bBe\s+it\s+enacted\s+by\s+the\s+(?:General\s+Assembly|Senate\s+and\s+House\s+of\s+Representatives)\b/gi,
    isSuppression: false,
  },
  {
    ruleId: "enactment.amendment_instruction",
    kind: CandidateKind.enactment_clause,
    pattern:
      /\bis\s+amended\s*(?:(?:and\s+reenacted\s+)?as\s+follows|by\s+(?:striking|inserting|adding)|--)/gi,
    isSuppression: false,
  },
];
