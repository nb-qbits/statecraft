const ALIASES: ReadonlyMap<string, string> = new Map([
  ["virginia", "us-va"],
  ["va", "us-va"],
  ["us-va", "us-va"],
  ["district of columbia", "us-dc"],
  ["dc", "us-dc"],
  ["us-dc", "us-dc"],
  ["federal", "us-fed"],
  ["us-fed", "us-fed"],
  ["united states", "us-fed"],
]);

export function normalizeJurisdiction(input: string): string {
  const canonical = ALIASES.get(input.toLowerCase().trim());
  if (canonical) return canonical;
  return input.toLowerCase().trim();
}
