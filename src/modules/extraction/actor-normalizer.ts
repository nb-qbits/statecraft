const NOISE_PREFIX_RE = /^(?:the|such|said|that|this|each)\s+/i;

function stripNoise(name: string): string {
  return name.replace(NOISE_PREFIX_RE, "").trim();
}

/**
 * Normalises actor names within a document. Strips leading articles and
 * demonstratives, then groups by exact match on the stripped form.
 * No substring containment — "Bank" and "Bank Advisory Board" stay distinct.
 */
export function normalizeActors(
  actors: readonly (string | null)[],
): Map<string, string> {
  const result = new Map<string, string>();

  for (const actor of actors) {
    if (actor === null || actor.trim().length === 0) continue;
    result.set(actor, stripNoise(actor));
  }

  return result;
}
