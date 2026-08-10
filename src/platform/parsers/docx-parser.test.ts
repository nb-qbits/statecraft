import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { createDocxParser, parseDocxAsync } from "./docx-parser.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", documentXml);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

function wrapBody(bodyContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyContent}
  </w:body>
</w:document>`;
}

function paragraph(text: string, options?: { italic?: boolean; strikethrough?: boolean; style?: string }): string {
  const pPr = options?.style
    ? `<w:pPr><w:pStyle w:val="${options.style}"/></w:pPr>`
    : "";

  let rPr = "";
  if (options?.italic || options?.strikethrough) {
    const parts = [];
    if (options.italic) parts.push("<w:i/>");
    if (options.strikethrough) parts.push("<w:strike/>");
    rPr = `<w:rPr>${parts.join("")}</w:rPr>`;
  }

  return `<w:p>${pPr}<w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;
}

describe("DOCX parser (sync interface)", () => {
  const parser = createDocxParser();

  it("has correct adapter ID and version", () => {
    expect(parser.adapterId).toBe("docx");
    expect(parser.version).toBe("1.0.0");
  });

  it("rejects non-DOCX mime type", () => {
    const result = parser.parse(Buffer.from("test"), "text/plain");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not handle");
  });

  it("rejects invalid ZIP bytes", () => {
    const result = parser.parse(Buffer.from("not a zip"), DOCX_MIME);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("ZIP");
  });

  it("returns async marker for valid ZIP bytes via sync interface", async () => {
    const zip = new JSZip();
    zip.file("test.txt", "hello");
    const validZip = await zip.generateAsync({ type: "nodebuffer" });
    const result = parser.parse(validZip, DOCX_MIME);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("async");
  });
});

describe("DOCX parser (async)", () => {
  it("parses a simple single-paragraph DOCX", async () => {
    const xml = wrapBody(paragraph("Be it enacted by the General Assembly of Virginia."));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0]!.runs[0]!.text).toBe("Be it enacted by the General Assembly of Virginia.");
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/p[0]");
  });

  it("detects italic run property", async () => {
    const xml = wrapBody(paragraph("italic text", { italic: true }));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs[0]!.properties.italic).toBe(true);
    expect(result.paragraphs[0]!.runs[0]!.properties.strikethrough).toBe(false);
  });

  it("detects strikethrough run property", async () => {
    const xml = wrapBody(paragraph("struck text", { strikethrough: true }));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs[0]!.properties.strikethrough).toBe(true);
    expect(result.paragraphs[0]!.runs[0]!.properties.italic).toBe(false);
  });

  it("handles mixed runs in a paragraph", async () => {
    const xml = wrapBody(`<w:p>
      <w:r><w:t xml:space="preserve">normal </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">italic </w:t></w:r>
      <w:r><w:rPr><w:strike/></w:rPr><w:t>struck</w:t></w:r>
    </w:p>`);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs).toHaveLength(3);
    expect(result.paragraphs[0]!.runs[0]!.text).toBe("normal ");
    expect(result.paragraphs[0]!.runs[0]!.properties.italic).toBe(false);
    expect(result.paragraphs[0]!.runs[1]!.text).toBe("italic ");
    expect(result.paragraphs[0]!.runs[1]!.properties.italic).toBe(true);
    expect(result.paragraphs[0]!.runs[2]!.text).toBe("struck");
    expect(result.paragraphs[0]!.runs[2]!.properties.strikethrough).toBe(true);
  });

  it("handles multiple paragraphs", async () => {
    const xml = wrapBody([
      paragraph("First paragraph."),
      paragraph("Second paragraph."),
      paragraph("Third paragraph."),
    ].join("\n"));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/p[0]");
    expect(result.paragraphs[1]!.structuralPath).toBe("/body/p[1]");
    expect(result.paragraphs[2]!.structuralPath).toBe("/body/p[2]");
  });

  it("detects heading styles for structural paths", async () => {
    const xml = wrapBody([
      paragraph("Chapter One", { style: "Heading1" }),
      paragraph("Some text."),
      paragraph("Section A", { style: "Heading2" }),
      paragraph("More text."),
    ].join("\n"));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.structuralPath).toContain("heading1");
    expect(result.paragraphs[2]!.structuralPath).toContain("heading2");
  });

  it("sets fidelity to declared", async () => {
    const xml = wrapBody(paragraph("text"));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fidelity).toBe("declared");
  });

  it("fails on invalid ZIP", async () => {
    const result = await parseDocxAsync(Buffer.from("not a zip at all"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("DOCX parsing failed");
  });

  it("fails when word/document.xml is missing", async () => {
    const zip = new JSZip();
    zip.file("other.xml", "<data/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("missing word/document.xml");
  });

  it("fails when document has no w:body", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:document>`;
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no w:body");
  });

  it("skips empty paragraphs", async () => {
    const xml = wrapBody(`
      ${paragraph("Text")}
      <w:p></w:p>
      ${paragraph("More text")}
    `);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(2);
  });

  it("handles w:t as string directly (no #text wrapper)", async () => {
    const xml = wrapBody(`<w:p>
      <w:r><w:t>plain string</w:t></w:r>
    </w:p>`);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs[0]!.text).toBe("plain string");
  });

  it("handles paragraph with no runs (no w:r)", async () => {
    const xml = wrapBody(`
      ${paragraph("Text before")}
      <w:p><w:pPr></w:pPr></w:p>
      ${paragraph("Text after")}
    `);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(2);
  });

  it("handles non-heading paragraph styles", async () => {
    const xml = wrapBody(paragraph("Normal text", { style: "BodyText" }));
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/p[0]");
  });

  it("handles empty DOCX (no paragraphs with text)", async () => {
    const xml = wrapBody(`<w:p></w:p>`);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no text content");
  });

  it("detects dstrike (double strikethrough) as strikethrough", async () => {
    const xml = wrapBody(`<w:p>
      <w:r><w:rPr><w:dstrike/></w:rPr><w:t>double struck</w:t></w:r>
    </w:p>`);
    const bytes = await buildDocx(xml);
    const result = await parseDocxAsync(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs[0]!.properties.strikethrough).toBe(true);
  });

});
