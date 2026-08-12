/**
 * Derives a human-readable provision label from a structuralPath.
 *
 * "/body/section[2.2-3704]/p[0]"  →  "§ 2.2-3704"
 * "/body/chapter[1]/section[2]/p[3]"  →  "Chapter 1, § 2"
 * "/body/p[4]"  →  "Paragraph 5"
 */
export function deriveProvisionLabel(structuralPath: string): string {
  const raw = structuralPath.replace(/^\/body\/?/, "");
  if (!raw) return "Document";

  const parts = raw.split("/").filter(Boolean);

  const labels: string[] = [];
  for (const part of parts) {
    const match = part.match(/^(\w+)\[(.+?)\]$/);
    if (!match) continue;

    const [, type, index] = match;

    if (type === "p") {
      if (labels.length === 0) {
        const num = parseInt(index!, 10);
        labels.push(`Paragraph ${isNaN(num) ? index : num + 1}`);
      }
      continue;
    }

    const label = formatSegmentPart(type!, index!);
    if (label) labels.push(label);
  }

  return labels.length > 0 ? labels.join(", ") : "Document";
}

function formatSegmentPart(type: string, index: string): string | null {
  const isCodeRef = /[.\-]/.test(index) || /^\d+\.\d/.test(index);

  switch (type) {
    case "section":
      return isCodeRef ? `§ ${index}` : `§ ${index}`;
    case "chapter":
      return `Chapter ${index}`;
    case "article":
      return `Article ${index}`;
    case "part":
      return `Part ${index}`;
    case "title":
      return `Title ${index}`;
    case "heading1":
    case "heading2":
    case "heading3":
    case "heading4":
      return `Section ${parseInt(index, 10) + 1}`;
    default:
      return `${type.charAt(0).toUpperCase() + type.slice(1)} ${index}`;
  }
}
