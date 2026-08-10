import JSZip from "jszip";
import { writeFileSync } from "node:fs";

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>CHAPTER 789</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">An Act to amend and reenact </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>§ 2.2-4002</w:t></w:r>
      <w:r><w:t xml:space="preserve"> of the Code of Virginia.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>SECTION 1. Definitions.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">As used in this chapter: </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>"Agency"</w:t></w:r>
      <w:r><w:t xml:space="preserve"> means any authority in the executive branch.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:strike/></w:rPr><w:t>This subsection is repealed.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>SECTION 2. Effective Date.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>This act shall become effective on July 1, 2025.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

async function main() {
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

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync("fixtures/documents/simple-bill.docx", buffer);
  console.log(`Created fixtures/documents/simple-bill.docx (${buffer.length} bytes)`);
}

main();
