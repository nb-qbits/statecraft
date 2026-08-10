import type { DocumentParser, ParseResult, CharacterAccounting } from "../../modules/parsing/types.js";
import {
  splitByBlankLines,
  splitByStructure,
  isPageFooter,
} from "./structural-segmentation.js";

const ADAPTER_ID = "plain-text";
const VERSION = "1.3.0";

const LINE_NUMBER_MARGIN = /^\s*\d{1,4}\s{2,}/;

interface PreprocessResult {
  lines: string[];
  strippedChars: number;
}

export function createPlainTextParser(): DocumentParser {
  return {
    adapterId: ADAPTER_ID,
    version: VERSION,
    parse(bytes: Buffer, mimeType: string): ParseResult {
      if (mimeType !== "text/plain") {
        return {
          ok: false,
          reason: `plain-text parser does not handle ${mimeType}`,
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      const text = bytes.toString("utf-8");
      const trimmed = text.trim();

      if (trimmed.length === 0) {
        return {
          ok: false,
          reason: "Document contains no text content after trimming",
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      const rawLines = text.split("\n");
      const hasLineNumbers = detectLineNumbers(rawLines);
      const preprocessed = preprocessLines(rawLines, hasLineNumbers);
      const contentLines = trimTrailingBlanks(preprocessed.lines);
      const hasBlankLines = contentLines.some(l => l.trim().length === 0);

      let paragraphs;
      let consumedCount;
      if (hasBlankLines) {
        const result = splitByBlankLines(contentLines);
        paragraphs = result.paragraphs;
        consumedCount = result.consumedCount;
      } else {
        const result = splitByStructure(contentLines);
        paragraphs = result.paragraphs;
        consumedCount = result.consumedCount;
      }

      const nonEmptyCount = contentLines.filter(l => l.trim().length > 0).length;
      if (consumedCount !== nonEmptyCount) {
        return {
          ok: false,
          reason: `Content coverage failure: ${nonEmptyCount - consumedCount} non-empty lines not in any segment (${consumedCount} consumed of ${nonEmptyCount})`,
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      if (paragraphs.length === 0) {
        return {
          ok: false,
          reason: "Document contains no text content after preprocessing",
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      const newlineCount = rawLines.length > 0 ? rawLines.length - 1 : 0;
      const preprocessedChars = preprocessed.lines.reduce((sum, l) => sum + l.length, 0);
      const segmentRawChars = paragraphs.reduce(
        (sum, p) => sum + p.runs.reduce((rs, r) => rs + r.text.length, 0),
        0,
      );
      const characterAccounting: CharacterAccounting = {
        inputChars: text.length,
        strippedChars: preprocessed.strippedChars,
        preprocessedChars,
        segmentRawChars,
      };

      const expectedPreprocessed = text.length - newlineCount - preprocessed.strippedChars;
      if (preprocessedChars !== expectedPreprocessed) {
        return {
          ok: false,
          reason: `Character accounting failure: preprocessed ${preprocessedChars} != expected ${expectedPreprocessed} (input ${text.length} - newlines ${newlineCount} - stripped ${preprocessed.strippedChars})`,
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      return {
        ok: true,
        paragraphs,
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
        fidelity: "none",
        characterAccounting,
      };
    },
  };
}

function detectLineNumbers(lines: string[]): boolean {
  const candidateLines = lines.filter(l => l.trim().length > 0).slice(0, 30);
  if (candidateLines.length < 5) return false;

  let matchCount = 0;
  let lastNumber = 0;
  let sequentialCount = 0;

  for (const line of candidateLines) {
    const match = /^(\s*\d{1,4})\s+/.exec(line);
    if (match) {
      matchCount++;
      const num = parseInt(match[1]!.trim(), 10);
      if (num === lastNumber + 1) sequentialCount++;
      lastNumber = num;
    }
  }

  return matchCount >= candidateLines.length * 0.7 && sequentialCount >= 3;
}

function preprocessLines(lines: string[], hasLineNumbers: boolean): PreprocessResult {
  const processed: string[] = [];
  let strippedChars = 0;

  for (const line of lines) {
    if (isPageFooter(line)) {
      strippedChars += line.length;
      continue;
    }
    const stripped = hasLineNumbers
      ? stripDetectedLineNumber(line)
      : stripLineNumberMargin(line);
    strippedChars += line.length - stripped.length;
    processed.push(stripped);
  }

  return { lines: processed, strippedChars };
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(0, end);
}

function stripLineNumberMargin(line: string): string {
  return line.replace(LINE_NUMBER_MARGIN, "");
}

function stripDetectedLineNumber(line: string): string {
  let result = line;
  for (let i = 0; i < 3; i++) {
    const stripped = result.replace(/^\s*\d{1,4}\s+/, "");
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}
