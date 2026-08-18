import { TemporalLexer } from "./lexer.js";
import { parserInstance } from "./parser.js";
import { temporalVisitor } from "./visitor.js";
import type {
  AnchoredSpan,
  ParseResult,
  SpanParseResult,
  TemporalExpression,
} from "./types.js";

export const GRAMMAR_VERSION = "1.7.0";

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

function parseText(text: string): ParseResult {
  const trimmed = dehyphenate(text.trim());
  if (trimmed.length === 0) {
    return { parsed: false, reason: "empty input", position: 0 };
  }

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
  /^(.+?\b(?:days?|hours?|workdays?)\b)\s+(of|after|from)\s+(.+)$/is;

const KNOWN_EVENT_RE = /^(?:the\s+)?(?:effective date|enactment|passage)\b/i;

function tryExtractWithTrailingScope(text: string): ParseResult | null {
  const m = TRAILING_SCOPE_RE.exec(text);
  if (!m) return null;

  const coreText = m[1]!.trim();
  const scopeText = m[3]!.trim();

  if (KNOWN_EVENT_RE.test(scopeText)) return null;

  const coreResult = attemptParse(coreText);
  if (!coreResult.parsed) return null;
  if (coreResult.expression.kind !== "relative_duration") return null;

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
