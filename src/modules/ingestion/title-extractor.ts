export interface ExtractedTitle {
  readonly displayNumber: string | null;
  readonly shortTitle: string | null;
  readonly chapter: string | null;
  readonly session: string | null;
  readonly stage: string | null;
}

interface BillNumberPattern {
  readonly pattern: RegExp;
  readonly format: (match: RegExpMatchArray) => string;
}

const BILL_NUMBER_PATTERNS: readonly BillNumberPattern[] = [
  // Federal: "H. R. 2409", "S. 1234", "H. J. Res. 5"
  {
    pattern: /\b(H\.\s*R\.\s*|S\.\s*|H\.\s*J\.\s*Res\.\s*|S\.\s*J\.\s*Res\.\s*|H\.\s*Con\.\s*Res\.\s*|S\.\s*Con\.\s*Res\.\s*)(\d+)\b/,
    format: (m) => `${m[1]!.replace(/\s+/g, " ").trim()} ${m[2]}`,
  },
  // State abbreviated with dots: "H.B. No. 3265", "H.B. ANo. A3265", "S.B.ANo.A3265"
  {
    pattern: /\b([HS])\.B\.\s*(?:A?No\.\s*)?A?(\d+)\b/i,
    format: (m) => `${m[1]!.toUpperCase() === "H" ? "HB" : "SB"} ${m[2]}`,
  },
  // State full: "HOUSE BILL NO. 346", "SENATE BILL 1234"
  {
    pattern: /\b(HOUSE|SENATE)\s+BILL\s+(?:NO\.\s*)?(\d+)\b/i,
    format: (m) => `${m[1]!.toUpperCase() === "HOUSE" ? "HB" : "SB"} ${m[2]}`,
  },
  // Resolution: "HOUSE JOINT RESOLUTION NO. 5"
  {
    pattern: /\b(HOUSE|SENATE)\s+((?:JOINT\s+)?)RESOLUTION\s+(?:NO\.\s*)?(\d+)\b/i,
    format: (m) => {
      const chamber = m[1]!.toUpperCase() === "HOUSE" ? "H" : "S";
      const joint = m[2]!.trim() ? "J" : "";
      return `${chamber}${joint}R ${m[3]}`;
    },
  },
  // Bare abbreviated: "SB 6", "HB 3265", "CS/SB 6" (common in state letterheads)
  {
    pattern: /\b(?:(?:CS\/)+)?([HS])B\s+(\d+)\b/,
    format: (m) => `${m[1]!.toUpperCase() === "H" ? "HB" : "SB"} ${m[2]}`,
  },
  // Virginia acts-of-assembly bracket notation: "[S 225]", "[H 1234]"
  {
    pattern: /\[([SH])\s+(\d+)\]/,
    format: (m) => `${m[1]!.toUpperCase() === "H" ? "H" : "S"} ${m[2]}`,
  },
];

const SHORT_TITLE_PATTERNS = [
  /may be cited as the\s+(.+?)(?:\.\s*$|\.(?:\s))/im,
];

const QUOTE_CHARS = /^["'‘’“”′‵]+|["'‘’“”′‵]+$/g;

const CHAPTER_RE = /\bCHAPTER\s+(\d+)\b/i;
const ACTS_SESSION_RE = /ACTS\s+OF\s+ASSEMBLY\s*[-–—]\s*(\d{4})\s+([\w\s]+?)\s*(?:SESSION|$)/i;
const APPROVED_RE = /\bApproved\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i;

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

function parseApprovalDate(raw: string): string | null {
  const m = raw.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTH_MAP[m[1]!.toLowerCase()];
  if (!month) return null;
  const day = m[2]!.padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

export function extractTitleFromSegments(
  segments: readonly { rawText: string }[],
): ExtractedTitle {
  const earlyText = segments.slice(0, 8).map(s => s.rawText).join("\n");

  const displayNumber = extractDisplayNumber(earlyText);
  const shortTitle = extractShortTitle(earlyText);

  const chapterMatch = earlyText.match(CHAPTER_RE);
  const chapter = chapterMatch ? chapterMatch[1]! : null;

  let session: string | null = null;
  let stage: string | null = null;

  const sessionMatch = earlyText.match(ACTS_SESSION_RE);
  if (sessionMatch) {
    const year = sessionMatch[1]!;
    const qualifier = sessionMatch[2]!.trim();
    const titleCased = qualifier
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    session = titleCased ? `${year} ${titleCased} Session` : `${year} Session`;
  }

  const approvedMatch = earlyText.match(APPROVED_RE);
  if (approvedMatch) {
    stage = "enacted";
  }

  return { displayNumber, shortTitle, chapter, session, stage };
}

export function extractApprovalDate(
  segments: readonly { rawText: string }[],
): string | null {
  const earlyText = segments.slice(0, 8).map(s => s.rawText).join("\n");
  const m = earlyText.match(APPROVED_RE);
  if (!m) return null;
  return parseApprovalDate(m[1]!);
}

function extractDisplayNumber(text: string): string | null {
  for (const { pattern, format } of BILL_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match) return format(match);
  }
  return null;
}

function extractShortTitle(text: string): string | null {
  for (const pattern of SHORT_TITLE_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1]) {
      let title = m[1].trim();
      title = title.replace(QUOTE_CHARS, "").replace(/[.\s]+$/, "");
      if (title.length > 3 && title.length < 200) {
        return title;
      }
    }
  }
  return null;
}

export function looksLikeFilename(value: string): boolean {
  if (value.includes("BILLS-") || value.includes("bills-")) return true;
  if (/^\d{2,}[a-z]+\d+[a-z]*$/i.test(value)) return true;
  // Bill number with leading zeros from filename convention: "HB03265F", "SB0006"
  if (/^[HS]B0\d/i.test(value)) return true;
  // API artifact: "bill-1225747", "bill_1234"
  if (/^bill[-_]\d+$/i.test(value)) return true;
  return false;
}
