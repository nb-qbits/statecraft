import { TemporalLexer } from "./lexer.js";
import { parserInstance } from "./parser.js";
import { temporalVisitor } from "./visitor.js";
import type {
  AnchoredSpan,
  ParseResult,
  SpanParseResult,
  TemporalExpression,
} from "./types.js";

export const GRAMMAR_VERSION = "1.1.0";

export function parseTemporalExpression(span: AnchoredSpan): SpanParseResult {
  const result = parseText(span.text);
  return {
    anchorId: span.anchorId,
    segmentId: span.segmentId,
    text: span.text,
    result,
  };
}

function parseText(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { parsed: false, reason: "empty input", position: 0 };
  }

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
    if (year < 1900 || year > 2200) {
      return { parsed: false, reason: `year ${year} out of range`, position: 0 };
    }
    const maxDays = new Date(year, month, 0).getDate();
    if (day < 1 || day > maxDays) {
      return { parsed: false, reason: `day ${day} invalid for month ${month}`, position: 0 };
    }
  }

  if (
    (expression.kind === "relative_duration" || expression.kind === "recurrence") &&
    expression.quantity <= 0
  ) {
    return { parsed: false, reason: "quantity must be positive", position: 0 };
  }

  return { parsed: true, expression };
}
