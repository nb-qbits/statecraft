import { TemporalLexer } from "./lexer.js";
import { parserInstance } from "./parser.js";
import { temporalVisitor } from "./visitor.js";
import type {
  AnchoredSpan,
  CapDate,
  CapDateRef,
  ParseResult,
  SpanParseResult,
  TemporalExpression,
} from "./types.js";

export const GRAMMAR_VERSION = "2.0.0";

export function parseTemporalExpression(span: AnchoredSpan): SpanParseResult {
  const result = parseText(span.text);
  return {
    anchorId: span.anchorId,
    segmentId: span.segmentId,
    text: span.text,
    result,
  };
}

function dehyphenate(text: string): string {
  return text.replace(/(\w)- (\w)/g, "$1$2");
}

const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December";
const CAP_CLAUSE_RE = new RegExp(
  `,?\\s+or\\s+(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(\\d{4}),?\\s+whichever\\s+is\\s+(sooner|earlier|later)\\s*\\.?$`,
  "i",
);

const MONTH_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const CAP_DEP_CLAUSE_RE = new RegExp(
  `,?\\s+or\\s+(${MONTH_NAMES})\\s+(\\d{1,2})` +
  `\\s+of\\s+the\\s+calendar\\s+year\\s+` +
  `(following\\s+)?` +
  `the\\s+calendar\\s+year\\s+described\\s+in\\s+` +
  `subsection\\s+(\\([a-z]\\)(?:\\(\\d+\\))?)` +
  `,?\\s+whichever\\s+is\\s+(sooner|earlier|later)\\s*\\.?$`,
  "i",
);

function extractCapClause(text: string): { stripped: string; cap: CapDate | CapDateRef } | null {
  const depMatch = CAP_DEP_CLAUSE_RE.exec(text);
  if (depMatch) {
    const month = MONTH_NUM[depMatch[1]!.toLowerCase()]!;
    const day = parseInt(depMatch[2]!, 10);
    const following = !!depMatch[3];
    const dependencyRef = depMatch[4]!;
    const capKind = depMatch[5]!.toLowerCase() === "later" ? "later" as const : "sooner" as const;
    return {
      stripped: text.slice(0, depMatch.index).trim(),
      cap: {
        month,
        day,
        yearSource: "dependency_ref" as const,
        dependencyRef,
        yearOffset: following ? 1 : 0,
        capKind,
      },
    };
  }

  const m = CAP_CLAUSE_RE.exec(text);
  if (!m) return null;
  const month = MONTH_NUM[m[1]!.toLowerCase()]!;
  const day = parseInt(m[2]!, 10);
  const year = parseInt(m[3]!, 10);
  const capKind = m[4]!.toLowerCase() === "later" ? "later" as const : "sooner" as const;
  return {
    stripped: text.slice(0, m.index).trim(),
    cap: { month, day, year, capKind },
  };
}

const ORDINAL_WORD_MAP: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

const CALENDAR_YEAR_RE = new RegExp(
  `^(?:not\\s+later\\s+than\\s+)?` +
  `(${MONTH_NAMES})\\s+(\\d{1,2})` +
  `\\s+of\\s+the\\s+` +
  `(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)` +
  `\\s+calendar\\s+years?` +
  `\\s+beginning\\s+after\\s+` +
  `(.+?)\\s*\\.?$`,
  "i",
);

function tryCalendarYearAnchoredDate(text: string): ParseResult | null {
  const m = CALENDAR_YEAR_RE.exec(text);
  if (!m) return null;

  const month = MONTH_NUM[m[1]!.toLowerCase()]!;
  const day = parseInt(m[2]!, 10);
  if (day < 1 || day > 31) return null;

  const offset = ORDINAL_WORD_MAP[m[3]!.toLowerCase()]!;
  const eventText = m[4]!.trim();

  const knownEvent = matchKnownEvent(eventText);
  if (knownEvent === "partial_match") return null;

  return {
    parsed: true,
    expression: {
      kind: "calendar_year_anchored_date" as const,
      month,
      day,
      calendarYearOffset: offset,
      referenceEvent: knownEvent ? knownEvent.event : null,
      referenceEventText: knownEvent ? null : eventText,
    },
  };
}

function parseText(text: string): ParseResult {
  const trimmed = dehyphenate(text.trim());
  if (trimmed.length === 0) {
    return { parsed: false, reason: "empty input", position: 0 };
  }

  const capResult = extractCapClause(trimmed);
  if (capResult) {
    const inner = parseText(capResult.stripped);
    if (inner.parsed && inner.expression.kind === "relative_duration") {
      return {
        parsed: true,
        expression: { ...inner.expression, capDate: capResult.cap },
      };
    }
  }

  const calYear = tryCalendarYearAnchoredDate(trimmed);
  if (calYear) return calYear;

  const combined = tryCombinedFixedRecurrence(trimmed);
  if (combined) return combined;

  const result = attemptParse(trimmed);
  if (result.parsed) return result;

  const withScope = tryExtractWithTrailingScope(trimmed);
  if (withScope) return withScope;

  if (result.reason.startsWith("unexpected character")) {
    const stripped = stripLeadingContext(trimmed);
    if (stripped !== null) {
      return parseText(stripped);
    }
  }

  return result;
}

function attemptParse(trimmed: string): ParseResult {
  const lexResult = TemporalLexer.tokenize(trimmed);

  if (lexResult.errors.length > 0) {
    const err = lexResult.errors[0]!;
    return {
      parsed: false,
      reason: `unexpected character '${trimmed[err.offset]}'`,
      position: err.offset,
    };
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.temporalExpression();

  if (parserInstance.errors.length > 0) {
    const err = parserInstance.errors[0]!;
    const pos = err.token?.startOffset ?? 0;
    return {
      parsed: false,
      reason: err.message,
      position: pos,
    };
  }

  if (lexResult.tokens.length > 0) {
    const lastToken = lexResult.tokens[lexResult.tokens.length - 1]!;
    const lastTokenEnd = lastToken.startOffset + lastToken.image.length;
    const remainingText = trimmed.slice(lastTokenEnd).trim();
    if (remainingText.length > 0) {
      return {
        parsed: false,
        reason: `unexpected trailing text: '${remainingText}'`,
        position: lastTokenEnd,
      };
    }
  }

  const expression = temporalVisitor.visit(cst) as TemporalExpression;

  if (expression.kind === "fixed_date") {
    const { month, day, year } = expression;
    if (year !== null) {
      if (year < 1900 || year > 2200) {
        return { parsed: false, reason: `year ${year} out of range`, position: 0 };
      }
      const maxDays = new Date(year, month, 0).getDate();
      if (day < 1 || day > maxDays) {
        return { parsed: false, reason: `day ${day} invalid for month ${month}`, position: 0 };
      }
    } else {
      if (day < 1 || day > 31) {
        return { parsed: false, reason: `day ${day} invalid`, position: 0 };
      }
    }
  }

  if (expression.kind === "relative_duration" && expression.quantity <= 0) {
    return { parsed: false, reason: "quantity must be positive", position: 0 };
  }

  if (expression.kind === "recurrence" && expression.interval <= 0) {
    return { parsed: false, reason: "interval must be positive", position: 0 };
  }

  return { parsed: true, expression };
}

const COMBINED_RE = /^(.+),\s*and\s+((?:each|every)\b.+)$/is;

function tryCombinedFixedRecurrence(text: string): ParseResult | null {
  const m = COMBINED_RE.exec(text);
  if (!m) return null;

  const fixedPart = m[1]!.trim();
  const recurrencePart = m[2]!.trim();

  const fixedResult = attemptParse(fixedPart);
  if (!fixedResult.parsed) return null;
  if (fixedResult.expression.kind !== "fixed_date") return null;
  if (fixedResult.expression.year === null) return null;

  const recResult = attemptParse(recurrencePart);
  if (!recResult.parsed) return null;
  if (recResult.expression.kind !== "recurrence") return null;

  const rec = recResult.expression;
  return {
    parsed: true,
    expression: {
      ...rec,
      byMonth: rec.byMonth ?? fixedResult.expression.month,
      byMonthDay: rec.byMonthDay ?? fixedResult.expression.day,
      anchorYear: fixedResult.expression.year,
    },
  };
}

const TRAILING_SCOPE_RE =
  /^(.+?\b(?:days?|hours?|workdays?|months?|years?)\b)\s+(of|after|from)\s+(.+)$/is;

const ENACTMENT_SCOPE_RE = /^(?:the\s+)?(?:date\s+of\s+(?:the\s+)?)?enactment(?:\s+of\s+(?:the|this)\s+(?:act|chapter|section|title))?$/i;
const EFFECTIVE_DATE_SCOPE_RE = /^(?:the\s+)?effective\s+date(?:\s+of\s+(?:the|this)\s+(?:act|chapter|section|title))?$/i;
const PASSAGE_SCOPE_RE = /^(?:the\s+)?(?:date\s+of\s+(?:the\s+)?)?passage(?:\s+of\s+(?:the|this)\s+(?:act|chapter|section|title))?$/i;

const KNOWN_EVENT_PREFIX_RE = /^(?:the\s+)?(?:(?:date\s+of\s+(?:the\s+)?)?(?:enactment|passage)|effective\s+date)\b/i;

type KnownEventMatch = { event: "enactment" | "effective_date" | "passage" } | "partial_match" | null;

function matchKnownEvent(scopeText: string): KnownEventMatch {
  if (ENACTMENT_SCOPE_RE.test(scopeText)) return { event: "enactment" };
  if (EFFECTIVE_DATE_SCOPE_RE.test(scopeText)) return { event: "effective_date" };
  if (PASSAGE_SCOPE_RE.test(scopeText)) return { event: "passage" };
  if (KNOWN_EVENT_PREFIX_RE.test(scopeText)) return "partial_match";
  return null;
}

function tryExtractWithTrailingScope(text: string): ParseResult | null {
  const m = TRAILING_SCOPE_RE.exec(text);
  if (!m) return null;

  const coreText = m[1]!.trim();
  const scopeText = m[3]!.trim();

  const coreResult = attemptParse(coreText);
  if (!coreResult.parsed) return null;
  if (coreResult.expression.kind !== "relative_duration") return null;

  const knownEvent = matchKnownEvent(scopeText);
  if (knownEvent === "partial_match") return null;
  if (knownEvent) {
    return {
      parsed: true,
      expression: {
        ...coreResult.expression,
        referenceEvent: knownEvent.event,
        referenceEventText: null,
      },
    };
  }

  return {
    parsed: true,
    expression: { ...coreResult.expression, referenceEventText: scopeText },
  };
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const LEADING_CONTEXT_RE = new RegExp(
  `^.+?\\b(by\\s+(?:${MONTHS})\\b.*)$`,
  "is",
);

/**
 * If the text has unrecognised leading words before "by <Month>...",
 * return the substring starting at "by".  Returns null when no such
 * pattern is found (e.g. "reviewed by the oversight committee").
 */
function stripLeadingContext(text: string): string | null {
  const m = LEADING_CONTEXT_RE.exec(text);
  return m ? m[1]! : null;
}
