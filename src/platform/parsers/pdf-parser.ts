import type { ParseResult, CharacterAccounting, NonBodyRun } from "../../modules/parsing/types.js";
import {
  splitByBlankLines,
  splitByStructure,
  splitOnEmbeddedSections,
  reconcileWithEnactingClause,
  isPageFooter,
  detectLineNumbers,
  stripDetectedLineNumber,
} from "./structural-segmentation.js";

const ADAPTER_ID = "pdf";
const VERSION = "1.6.0";

export interface SidecarPage {
  readonly pageNumber: number;
  readonly text: string;
  readonly hasTextLayer: boolean;
  readonly charCount: number;
  readonly marginalNotes?: readonly string[];
  readonly runningHeaders?: readonly string[];
  readonly pageFooters?: readonly string[];
  readonly backMatter?: string;
}

export interface SidecarResponse {
  readonly version: string;
  readonly pages: readonly SidecarPage[];
  readonly metadata: {
    readonly fonts: readonly string[];
    readonly pageCount: number;
    readonly hasTextLayer: boolean;
  };
}

export interface SidecarClient {
  parsePdf(bytes: Buffer): Promise<SidecarResponse>;
  getContractVersion(): Promise<string>;
}

export function createSidecarClient(baseUrl: string): SidecarClient {
  return {
    async getContractVersion(): Promise<string> {
      try {
        const res = await fetch(`${baseUrl}/health`);
        if (!res.ok) return "unknown";
        const body = (await res.json()) as { contractVersion?: string };
        return body.contractVersion ?? "unknown";
      } catch {
        return "unknown";
      }
    },

    async parsePdf(bytes: Buffer): Promise<SidecarResponse> {
      const formData = new FormData();
      formData.append("file", new Blob([bytes as unknown as ArrayBuffer]), "document.pdf");

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/v1/parse`, {
          method: "POST",
          body: formData,
        });
      } catch (err) {
        throw new Error(
          `Sidecar connection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (res.status === 422) {
        const body = (await res.json()) as { error: string };
        throw new Error(`Sidecar rejected PDF: ${body.error}`);
      }

      if (!res.ok) {
        throw new Error(`Sidecar returned ${res.status}: ${await res.text()}`);
      }

      return (await res.json()) as SidecarResponse;
    },
  };
}

type ParsePdfFn = {
  (bytes: Buffer): Promise<ParseResult>;
  parserVersion: string;
};

export function createPdfParser(sidecarClient: SidecarClient, sidecarVersion?: string): ParsePdfFn {
  const compositeVersion = sidecarVersion
    ? `${VERSION}+sidecar-${sidecarVersion}`
    : VERSION;

  const parsePdf: ParsePdfFn = async (bytes: Buffer): Promise<ParseResult> => {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return {
        ok: false,
        reason: "Not a valid PDF file (missing %PDF- header)",
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    let sidecarResult: SidecarResponse;
    try {
      sidecarResult = await sidecarClient.parsePdf(bytes);
    } catch (err) {
      return {
        ok: false,
        reason: `Sidecar error: ${err instanceof Error ? err.message : String(err)}`,
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    if (!sidecarResult.metadata.hasTextLayer) {
      return {
        ok: false,
        reason: "Scanned PDF with no extractable text",
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    const textPages = sidecarResult.pages.filter(p => p.hasTextLayer);
    const pageTexts = textPages.map(p => p.text.replace(/\n+$/, ""));
    const rawText = pageTexts.join("\n");

    const nonBodyContent: NonBodyRun[] = [];
    for (const page of textPages) {
      if (page.marginalNotes) {
        for (const note of page.marginalNotes) {
          nonBodyContent.push({ type: "marginal_note", text: note, pageNumber: page.pageNumber });
        }
      }
      if (page.runningHeaders) {
        for (const hdr of page.runningHeaders) {
          nonBodyContent.push({ type: "running_header", text: hdr, pageNumber: page.pageNumber });
        }
      }
      if (page.pageFooters) {
        for (const ftr of page.pageFooters) {
          nonBodyContent.push({ type: "page_footer", text: ftr, pageNumber: page.pageNumber });
        }
      }
      if (page.backMatter) {
        nonBodyContent.push({ type: "back_matter", text: page.backMatter, pageNumber: page.pageNumber });
      }
    }

    if (rawText.trim().length === 0) {
      return {
        ok: false,
        reason: "PDF contains no text content after extraction",
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    const lines = rawText.split("\n");
    const contentLines = lines.filter(l => !isPageFooter(l));
    const hasLineNumbers = detectLineNumbers(contentLines);
    let lineNumberCharsStripped = 0;
    const processedLines = hasLineNumbers
      ? contentLines.map(l => {
          const stripped = stripDetectedLineNumber(l);
          lineNumberCharsStripped += l.length - stripped.length;
          return stripped;
        })
      : contentLines;
    const repairedLines = repairCrossPageHyphens(processedLines);
    const trimmedLines = trimTrailingBlanks(repairedLines);
    const hasBlankLines = trimmedLines.some(l => l.trim().length === 0);

    let splitParagraphs;
    let consumedCount;
    if (hasBlankLines) {
      const result = splitByBlankLines(trimmedLines);
      splitParagraphs = splitOnEmbeddedSections(result.paragraphs);
      consumedCount = result.consumedCount;
    } else {
      const result = splitByStructure(trimmedLines);
      splitParagraphs = splitOnEmbeddedSections(result.paragraphs);
      consumedCount = result.consumedCount;
    }

    const reconciliation = reconcileWithEnactingClause(splitParagraphs);
    const paragraphs = reconciliation.paragraphs;
    const warnings = reconciliation.warnings;

    const nonEmptyCount = trimmedLines.filter(l => l.trim().length > 0).length;
    if (consumedCount !== nonEmptyCount) {
      return {
        ok: false,
        reason: `Content coverage failure: ${nonEmptyCount - consumedCount} non-empty lines not in any segment (${consumedCount} consumed of ${nonEmptyCount})`,
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    if (paragraphs.length === 0) {
      return {
        ok: false,
        reason: "PDF contains no text content after segmentation",
        parserAdapter: ADAPTER_ID,
        parserVersion: compositeVersion,
      };
    }

    const segmentRawChars = paragraphs.reduce(
      (sum, p) => sum + p.runs.reduce((rs, r) => rs + r.text.length, 0),
      0,
    );

    const characterAccounting: CharacterAccounting = {
      inputChars: rawText.length,
      strippedChars: lineNumberCharsStripped,
      preprocessedChars: rawText.length - lineNumberCharsStripped,
      segmentRawChars,
    };

    return {
      ok: true,
      paragraphs,
      parserAdapter: ADAPTER_ID,
      parserVersion: compositeVersion,
      fidelity: "inferred",
      characterAccounting,
      ...(nonBodyContent.length > 0 ? { nonBodyContent } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };

  parsePdf.parserVersion = compositeVersion;
  return parsePdf;
}

function repairCrossPageHyphens(lines: string[]): string[] {
  if (lines.length < 2) return lines;

  const compoundWords = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/([a-zA-Z]+)-([a-zA-Z]+)/g)) {
      if (m.index! + m[0].length < line.trimEnd().length) {
        compoundWords.add(`${m[1]!.toLowerCase()}-${m[2]!.toLowerCase()}`);
      }
    }
  }

  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const stripped = line.trimEnd();
    if (
      i + 1 < lines.length &&
      stripped.length >= 2 &&
      stripped.endsWith("-") &&
      stripped[stripped.length - 2]!.match(/[a-zA-Z]/)
    ) {
      const nextLine = lines[i + 1]!.trimStart();
      const m = nextLine.match(/^([a-z]+)(.*)/);
      if (m) {
        const prefixMatch = stripped.match(/([a-zA-Z]+)-$/);
        const isCompound = prefixMatch &&
          compoundWords.has(`${prefixMatch[1]!.toLowerCase()}-${m[1]!.toLowerCase()}`);

        if (isCompound) {
          result.push(stripped + m[1]);
        } else {
          result.push(stripped.slice(0, -1) + m[1]);
        }
        const rest = m[2]!.trim();
        if (rest) {
          lines[i + 1] = rest;
        } else {
          i += 2;
          continue;
        }
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
    i++;
  }
  return result;
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(0, end);
}
