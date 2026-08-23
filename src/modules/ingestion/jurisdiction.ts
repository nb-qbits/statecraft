export interface JurisdictionDef {
  readonly code: string;
  readonly displayName: string;
  readonly postalCode?: string;
}

export const JURISDICTIONS: readonly JurisdictionDef[] = [
  { code: "us-fed", displayName: "Federal" },
  { code: "us-va", displayName: "Virginia", postalCode: "VA" },
  { code: "us-tx", displayName: "Texas", postalCode: "TX" },
  { code: "us-fl", displayName: "Florida", postalCode: "FL" },
  { code: "us-dc", displayName: "District of Columbia", postalCode: "DC" },
];

const ALIASES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const j of JURISDICTIONS) {
    m.set(j.code, j.code);
    m.set(j.displayName.toLowerCase(), j.code);
    if (j.postalCode) m.set(j.postalCode.toLowerCase(), j.code);
  }
  m.set("united states", "us-fed");
  return m;
})();

const STATE_NAME_TO_CODE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const j of JURISDICTIONS) {
    if (j.code !== "us-fed") {
      m.set(j.displayName.toLowerCase(), j.code);
    }
  }
  return m;
})();

export function normalizeJurisdiction(input: string): string {
  const canonical = ALIASES.get(input.toLowerCase().trim());
  if (canonical) return canonical;
  return input.toLowerCase().trim();
}

const FEDERAL_ENACTMENT = /Be it enacted by the Senate and House of Representatives/i;
const STATE_LEGISLATURE_RE = /Legislature of the State of\s+([A-Za-z\s]+?)(?:\s*[:;,.]|\s*$)/im;
const GENERAL_ASSEMBLY_RE = /General Assembly of\s+([A-Za-z\s]+?)(?:\s*[:;,.]|\s*$)/im;
const ACTS_OF_ASSEMBLY_RE = /([A-Z][A-Za-z\s]+?)\s+ACTS\s+OF\s+ASSEMBLY/i;

const STATE_LETTERHEAD_RE: RegExp | null = (() => {
  const names = [...STATE_NAME_TO_CODE.keys()].filter(n => n !== "district of columbia");
  if (names.length === 0) return null;
  const escaped = names.map(n => n.replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`\\b(${escaped})\\s+(?:SENATE|HOUSE)`, "i");
})();

function lookupStateName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return STATE_NAME_TO_CODE.get(name) ?? null;
}

export function inferJurisdictionFromText(text: string): string | null {
  if (FEDERAL_ENACTMENT.test(text)) return "us-fed";

  const legMatch = text.match(STATE_LEGISLATURE_RE);
  if (legMatch) {
    const code = lookupStateName(legMatch[1]!);
    if (code) return code;
  }

  const gaMatch = text.match(GENERAL_ASSEMBLY_RE);
  if (gaMatch) {
    const code = lookupStateName(gaMatch[1]!);
    if (code) return code;
  }

  const aoaMatch = text.match(ACTS_OF_ASSEMBLY_RE);
  if (aoaMatch) {
    const code = lookupStateName(aoaMatch[1]!);
    if (code) return code;
  }

  if (STATE_LETTERHEAD_RE) {
    const lhMatch = text.match(STATE_LETTERHEAD_RE);
    if (lhMatch) {
      const code = lookupStateName(lhMatch[1]!);
      if (code) return code;
    }
  }

  return null;
}
