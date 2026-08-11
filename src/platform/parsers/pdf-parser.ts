import type { ParseResult, CharacterAccounting } from "../../modules/parsing/types.js";
import {
  splitByBlankLines,
  splitByStructure,
  isPageFooter,
} from "./structural-segmentation.js";

const ADAPTER_ID = "pdf";
const VERSION = "1.0.0";

export interface SidecarPage {
  readonly pageNumber: number;
  readonly text: string;
  readonly hasTextLayer: boolean;
  readonly charCount: number;
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
}

export function createSidecarClient(baseUrl: string): SidecarClient {
  return {
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

export function createPdfParser(sidecarClient: SidecarClient): ParsePdfFn {
  const parsePdf: ParsePdfFn = async (bytes: Buffer): Promise<ParseResult> => {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return {
        ok: false,
        reason: "Not a valid PDF file (missing %PDF- header)",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
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
        parserVersion: VERSION,
      };
    }

    if (!sidecarResult.metadata.hasTextLayer) {
      return {
        ok: false,
        reason: "Scanned PDF with no extractable text",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    const pageTexts = sidecarResult.pages
      .filter(p => p.hasTextLayer)
      .map(p => p.text.replace(/\n+$/, ""));
    const rawText = pageTexts.join("\n");

    if (rawText.trim().length === 0) {
      return {
        ok: false,
        reason: "PDF contains no text content after extraction",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    const lines = rawText.split("\n");
    const contentLines = lines.filter(l => !isPageFooter(l));
    const trimmedLines = trimTrailingBlanks(contentLines);
    const hasBlankLines = trimmedLines.some(l => l.trim().length === 0);

    let paragraphs;
    let consumedCount;
    if (hasBlankLines) {
      const result = splitByBlankLines(trimmedLines);
      paragraphs = result.paragraphs;
      consumedCount = result.consumedCount;
    } else {
      const result = splitByStructure(trimmedLines);
      paragraphs = result.paragraphs;
      consumedCount = result.consumedCount;
    }

    const nonEmptyCount = trimmedLines.filter(l => l.trim().length > 0).length;
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
        reason: "PDF contains no text content after segmentation",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    const segmentRawChars = paragraphs.reduce(
      (sum, p) => sum + p.runs.reduce((rs, r) => rs + r.text.length, 0),
      0,
    );

    const characterAccounting: CharacterAccounting = {
      inputChars: rawText.length,
      strippedChars: 0,
      preprocessedChars: rawText.length,
      segmentRawChars,
    };

    return {
      ok: true,
      paragraphs,
      parserAdapter: ADAPTER_ID,
      parserVersion: VERSION,
      fidelity: "inferred",
      characterAccounting,
    };
  };

  parsePdf.parserVersion = VERSION;
  return parsePdf;
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(0, end);
}
