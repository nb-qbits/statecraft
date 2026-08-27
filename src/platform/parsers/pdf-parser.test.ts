import { describe, it, expect, vi, afterEach } from "vitest";
import type { SidecarClient, SidecarResponse } from "./pdf-parser.js";
import { createPdfParser, createSidecarClient } from "./pdf-parser.js";

const PDF_MAGIC = Buffer.from("%PDF-1.4 fake");
const NOT_PDF = Buffer.from("not a pdf");

function makeSidecarResponse(overrides: Partial<SidecarResponse> = {}): SidecarResponse {
  return {
    version: "1.3.0",
    pages: [
      {
        pageNumber: 1,
        text: "Be it enacted by the General Assembly of Virginia:\n1. That § 2.2-3705.1 of the Code of Virginia is amended and reenacted as follows:\n§ 2.2-3705.1. Title of section.\nA. First subsection text here.\nB. Second subsection text here.\n1. First numbered subdivision.\n2. Second numbered subdivision.",
        hasTextLayer: true,
        charCount: 200,
      },
    ],
    metadata: {
      fonts: ["Times-Roman"],
      pageCount: 1,
      hasTextLayer: true,
    },
    ...overrides,
  };
}

function makeSidecarClient(response?: SidecarResponse | Error): SidecarClient {
  return {
    getContractVersion: vi.fn(async () => "1.3.0"),
    parsePdf: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response ?? makeSidecarResponse();
    }),
  };
}

describe("pdf-parser", () => {
  it("has correct parserVersion", () => {
    const parser = createPdfParser(makeSidecarClient());
    expect(parser.parserVersion).toBe("1.6.0");
  });

  it("rejects non-PDF input", async () => {
    const parser = createPdfParser(makeSidecarClient());
    const result = await parser(NOT_PDF);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("%PDF-");
      expect(result.parserAdapter).toBe("pdf");
    }
  });

  it("parses PDF with text layer and returns segments", async () => {
    const parser = createPdfParser(makeSidecarClient());
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs.length).toBeGreaterThan(0);
    expect(result.fidelity).toBe("inferred");
    expect(result.parserAdapter).toBe("pdf");
    expect(result.parserVersion).toBe("1.6.0");
  });

  it("applies structural segmentation to sidecar output", async () => {
    const parser = createPdfParser(makeSidecarClient());
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const aSubsection = texts.find(t => t.startsWith("A."));
    expect(aSubsection).toBeDefined();
    const bSubsection = texts.find(t => t.startsWith("B."));
    expect(bSubsection).toBeDefined();
  });

  it("returns parse failure for scanned PDF (no text layer)", async () => {
    const response = makeSidecarResponse({
      pages: [{ pageNumber: 1, text: "", hasTextLayer: false, charCount: 0 }],
      metadata: { fonts: [], pageCount: 1, hasTextLayer: false },
    });
    const parser = createPdfParser(makeSidecarClient(response));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Scanned PDF");
    }
  });

  it("returns parse failure on sidecar connection error", async () => {
    const parser = createPdfParser(makeSidecarClient(new Error("Connection refused")));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Connection refused");
    }
  });

  it("returns parse failure on sidecar rejection", async () => {
    const parser = createPdfParser(makeSidecarClient(new Error("Sidecar rejected PDF: corrupt")));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("corrupt");
    }
  });

  it("returns parse failure when PDF has text layer but empty text", async () => {
    const response = makeSidecarResponse({
      pages: [{ pageNumber: 1, text: "   \n  \n  ", hasTextLayer: true, charCount: 5 }],
      metadata: { fonts: ["Times-Roman"], pageCount: 1, hasTextLayer: true },
    });
    const parser = createPdfParser(makeSidecarClient(response));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("no text content");
    }
  });

  it("includes character accounting on success", async () => {
    const parser = createPdfParser(makeSidecarClient());
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.characterAccounting).toBeDefined();
    expect(result.characterAccounting!.segmentRawChars).toBeGreaterThan(0);
  });

  it("handles multi-page PDF with blank lines between pages", async () => {
    const response = makeSidecarResponse({
      pages: [
        { pageNumber: 1, text: "First paragraph.\n\nSecond paragraph.", hasTextLayer: true, charCount: 30 },
        { pageNumber: 2, text: "Third paragraph.", hasTextLayer: true, charCount: 16 },
      ],
      metadata: { fonts: ["Times-Roman"], pageCount: 2, hasTextLayer: true },
    });
    const parser = createPdfParser(makeSidecarClient(response));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it("strips page footers from sidecar output", async () => {
    const response = makeSidecarResponse({
      pages: [
        { pageNumber: 1, text: "Content here.\n  - 1 -  \nMore content.", hasTextLayer: true, charCount: 30 },
      ],
      metadata: { fonts: ["Times-Roman"], pageCount: 1, hasTextLayer: true },
    });
    const parser = createPdfParser(makeSidecarClient(response));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allText = result.paragraphs.map(p => p.runs[0]!.text).join(" ");
    expect(allText).not.toContain("- 1 -");
  });

  it("strips embedded line numbers from congressional-style PDF text", async () => {
    const response = makeSidecarResponse({
      pages: [
        {
          pageNumber: 1,
          text: [
            "1 Be it enacted by the Senate and House",
            "2 of Representatives of the United States of America",
            "3 in Congress assembled,",
            "4 SECTION 1. SHORT TITLE.",
            "5 This Act may be cited as the ''Example Act''.",
            "6 SEC. 2. DEADLINE.",
            "7 Not later than 90 days after the date",
            "8 of the enactment of this Act, the Secretary",
            "9 shall submit a report.",
          ].join("\n"),
          hasTextLayer: true,
          charCount: 300,
        },
      ],
      metadata: { fonts: ["Times-Roman"], pageCount: 1, hasTextLayer: true },
    });
    const parser = createPdfParser(makeSidecarClient(response));
    const result = await parser(PDF_MAGIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allText = result.paragraphs.map(p => p.runs[0]!.text).join(" ");
    expect(allText).toContain("Not later than 90 days after the date");
    expect(allText).not.toMatch(/^\d+\s+Be it/m);
  });
});

describe("createSidecarClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends PDF bytes and returns parsed response", async () => {
    const mockResponse = makeSidecarResponse();
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const client = createSidecarClient("http://localhost:8000");
    const result = await client.parsePdf(Buffer.from("pdf bytes"));

    expect(result.version).toBe("1.3.0");
    expect(result.pages).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("throws on connection failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const client = createSidecarClient("http://localhost:9999");
    await expect(client.parsePdf(Buffer.from("pdf"))).rejects.toThrow("Sidecar connection failed");
  });

  it("throws on 422 with error message", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "corrupt PDF" }), { status: 422 }),
    );

    const client = createSidecarClient("http://localhost:8000");
    await expect(client.parsePdf(Buffer.from("pdf"))).rejects.toThrow("Sidecar rejected PDF: corrupt PDF");
  });

  it("throws on unexpected status code", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Internal Server Error", { status: 500 }),
    );

    const client = createSidecarClient("http://localhost:8000");
    await expect(client.parsePdf(Buffer.from("pdf"))).rejects.toThrow("Sidecar returned 500");
  });
});
