import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { DocumentParser, ParseResult, ParsedParagraph, ParsedRun, RunProperty } from "../../modules/parsing/types.js";

const ADAPTER_ID = "docx";
const VERSION = "1.0.0";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "w:p" || name === "w:r" || name === "w:t",
  removeNSPrefix: false,
  preserveOrder: false,
  trimValues: false,
});

export function createDocxParser(): DocumentParser {
  return {
    adapterId: ADAPTER_ID,
    version: VERSION,
    parse(bytes: Buffer, mimeType: string): ParseResult {
      if (mimeType !== DOCX_MIME) {
        return {
          ok: false,
          reason: `docx parser does not handle ${mimeType}`,
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      // jszip.loadAsync is async but our interface is sync.
      // We'll use a synchronous parsing strategy.
      // Since jszip is fundamentally async, we need to make parse async or
      // use a workaround. Let's make the interface accommodate this.
      // For now, we do synchronous validation and return a result that
      // the service layer will handle.

      // Validate ZIP magic bytes (PK\x03\x04)
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
        return {
          ok: false,
          reason: "Not a valid ZIP file (DOCX requires ZIP container)",
          parserAdapter: ADAPTER_ID,
          parserVersion: VERSION,
        };
      }

      // Return a marker that tells the service to use parseAsync instead
      // This is a design compromise - see parseAsync for the real implementation
      return {
        ok: false,
        reason: "DOCX parsing requires async - use parseAsync",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    },
  };
}

export async function parseDocxAsync(bytes: Buffer): Promise<ParseResult> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = zip.file("word/document.xml");

    if (!docXmlFile) {
      return {
        ok: false,
        reason: "DOCX archive missing word/document.xml",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    const xmlContent = await docXmlFile.async("text");
    const parsed = xmlParser.parse(xmlContent);

    const body = extractBody(parsed);
    if (!body) {
      return {
        ok: false,
        reason: "DOCX document.xml has no w:body element",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    const paragraphs = extractParagraphs(body);

    if (paragraphs.length === 0) {
      return {
        ok: false,
        reason: "DOCX document contains no text content",
        parserAdapter: ADAPTER_ID,
        parserVersion: VERSION,
      };
    }

    return {
      ok: true,
      paragraphs,
      parserAdapter: ADAPTER_ID,
      parserVersion: VERSION,
      fidelity: "declared",
    };
  } catch (err) {
    return {
      ok: false,
      reason: `DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`,
      parserAdapter: ADAPTER_ID,
      parserVersion: VERSION,
    };
  }
}
parseDocxAsync.parserVersion = VERSION;

// XML parsing produces deeply nested untyped objects — eslint-disable for the extraction layer
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractBody(parsed: any): any {
  const doc = parsed?.["w:document"];
  if (!doc) return null;
  return doc["w:body"] ?? null;
}

function extractParagraphs(body: any): ParsedParagraph[] {
  const paragraphs: ParsedParagraph[] = [];
  const rawParagraphs = body["w:p"];
  if (!rawParagraphs) return paragraphs;

  const pArray = Array.isArray(rawParagraphs) ? rawParagraphs : [rawParagraphs];

  let pIndex = 0;
  let sectionStack: string[] = [];
  let localPIndex = 0;

  for (const p of pArray) {
    const runs = extractRuns(p);
    const fullText = runs.map(r => r.text).join("");
    if (fullText.trim().length === 0) continue;

    const style = extractParagraphStyle(p);
    const isHeading = style !== null && /^Heading/i.test(style);

    if (isHeading) {
      const headingLevel = extractHeadingLevel(style!);
      sectionStack = updateStack(sectionStack, headingLevel, fullText.trim(), pIndex);
      localPIndex = 0;
    }

    const structuralPath = buildDocxPath(sectionStack, localPIndex);
    paragraphs.push({ structuralPath, runs });
    localPIndex++;
    pIndex++;
  }

  return paragraphs;
}

function extractRuns(p: any): ParsedRun[] {
  const runs: ParsedRun[] = [];
  const rawRuns = p["w:r"];
  if (!rawRuns) return runs;

  const rArray = Array.isArray(rawRuns) ? rawRuns : [rawRuns];

  for (const r of rArray) {
    const text = extractRunText(r);
    if (text.length === 0) continue;
    const properties = extractRunProperties(r);
    runs.push({ text, properties });
  }

  return runs;
}

function extractRunText(r: any): string {
  const tElements = r["w:t"];
  if (!tElements) return "";

  const tArray: any[] = Array.isArray(tElements) ? tElements : [tElements];
  return tArray.map((t: any): string => {
    if (typeof t === "string") return t;
    if (t !== null && typeof t === "object") return (t["#text"] as string) ?? "";
    return "";
  }).join("");
}

function extractRunProperties(r: any): RunProperty {
  const rPr = r["w:rPr"];
  if (!rPr) return { italic: false, strikethrough: false };

  const italic = rPr["w:i"] !== undefined;
  const strikethrough = rPr["w:strike"] !== undefined || rPr["w:dstrike"] !== undefined;

  return { italic, strikethrough };
}

function extractParagraphStyle(p: any): string | null {
  const pPr = p["w:pPr"];
  if (!pPr) return null;
  const pStyle = pPr["w:pStyle"];
  if (!pStyle) return null;
  if (typeof pStyle === "object" && pStyle !== null) {
    return (pStyle["@_w:val"] as string) ?? null;
  }
  return typeof pStyle === "string" ? pStyle : null;
}

function extractHeadingLevel(style: string): number {
  const match = /Heading(\d+)/i.exec(style);
  return match ? parseInt(match[1]!, 10) : 1;
}

function updateStack(current: string[], level: number, _text: string, pIndex: number): string[] {
  const entry = `heading${level}[${pIndex}]`;
  const newStack = current.filter(s => {
    const existingLevel = parseInt(s.match(/heading(\d+)/)?.[1] ?? "0", 10);
    return existingLevel < level;
  });
  newStack.push(entry);
  return newStack;
}

function buildDocxPath(sectionStack: string[], paragraphIndex: number): string {
  if (sectionStack.length === 0) {
    return `/body/p[${paragraphIndex}]`;
  }
  const sections = sectionStack.map(s => `/${s}`).join("");
  return `/body${sections}/p[${paragraphIndex}]`;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export const DOCX_ADAPTER_ID = ADAPTER_ID;
export const DOCX_VERSION = VERSION;
