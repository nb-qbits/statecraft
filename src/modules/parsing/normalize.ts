import type { NormalizeResult, OffsetMap } from "./types.js";

const SMART_QUOTE_MAP: Record<string, string> = {
  "“": '"', // "
  "”": '"', // "
  "„": '"', // „
  "‘": "'", // '
  "’": "'", // '
  "‚": "'", // ‚
  "«": '"', // «
  "»": '"', // »
};

const SOFT_HYPHEN = "­";

export function normalizeForEvidenceMatchV1(input: string): NormalizeResult {
  if (input.length === 0) {
    return {
      normalized: "",
      offsetMap: { normalizedToOriginal: [], originalToNormalized: [] },
    };
  }

  // Step 1: NFKC normalization with offset tracking
  const nfkc = input.normalize("NFKC");
  const { mapped: nfkcMapped, n2o: nfkcN2O } = alignNfkc(input, nfkc);

  // Steps 2-6: character-by-character transformation on NFKC output
  const normalizedChars: string[] = [];
  const n2oFinal: number[] = [];
  const o2nFinal: number[] = new Array(input.length).fill(-1);

  let i = 0;
  while (i < nfkcMapped.length) {
    const ch = nfkcMapped[i]!;
    const origIdx = nfkcN2O[i]!;

    // Step 2: soft hyphen removal
    if (ch === SOFT_HYPHEN) {
      i++;
      continue;
    }

    // Step 3: line-break hyphenation rejoining (word-\nword → wordword)
    // Also handles PDF artifact: word- word → wordword (hyphen-space between word chars)
    if (ch === "-" && i > 0 && /\w/.test(nfkcMapped[i - 1]!)) {
      if (i + 1 < nfkcMapped.length && nfkcMapped[i + 1] === "\n") {
        i += 2; // skip hyphen and newline
        continue;
      }
      if (i + 1 < nfkcMapped.length && nfkcMapped[i + 1] === " " && i + 2 < nfkcMapped.length && /\w/.test(nfkcMapped[i + 2]!)) {
        i += 2; // skip hyphen and space
        continue;
      }
    }

    // Step 4: smart quotes → ASCII
    const replacement = SMART_QUOTE_MAP[ch];
    if (replacement !== undefined) {
      normalizedChars.push(replacement);
      n2oFinal.push(origIdx);
      i++;
      continue;
    }

    // Step 5+6: NBSP already handled by NFKC (→ regular space).
    // Whitespace collapse (space, tab, newline, CR → single space)
    if (/\s/.test(ch)) {
      // Only add a space if last char wasn't already a space
      if (normalizedChars.length === 0 || normalizedChars[normalizedChars.length - 1] !== " ") {
        normalizedChars.push(" ");
        n2oFinal.push(origIdx);
      }
      i++;
      continue;
    }

    normalizedChars.push(ch);
    n2oFinal.push(origIdx);
    i++;
  }

  // Trim leading/trailing spaces
  let start = 0;
  let end = normalizedChars.length;
  while (start < end && normalizedChars[start] === " ") start++;
  while (end > start && normalizedChars[end - 1] === " ") end--;

  const trimmedChars = normalizedChars.slice(start, end);
  const trimmedN2O = n2oFinal.slice(start, end);

  // Build original-to-normalized map
  for (let j = 0; j < trimmedN2O.length; j++) {
    const orig = trimmedN2O[j]!;
    if (orig < o2nFinal.length && o2nFinal[orig] === -1) {
      o2nFinal[orig] = j;
    }
  }

  // Fill gaps: unmapped original positions get the next mapped position
  let lastMapped = trimmedN2O.length > 0 ? trimmedN2O.length : 0;
  for (let j = o2nFinal.length - 1; j >= 0; j--) {
    if (o2nFinal[j] === -1) {
      o2nFinal[j] = lastMapped;
    } else {
      lastMapped = o2nFinal[j]!;
    }
  }

  const offsetMap: OffsetMap = {
    normalizedToOriginal: trimmedN2O,
    originalToNormalized: o2nFinal,
  };

  return {
    normalized: trimmedChars.join(""),
    offsetMap,
  };
}

function alignNfkc(
  original: string,
  nfkc: string,
): { mapped: string; n2o: number[]; o2n: number[] } {
  // For most text, NFKC doesn't change length, so we can use identity mapping.
  // When it does (ligatures, compatibility chars), we align with a two-pointer pass.
  if (original === nfkc) {
    const identity = Array.from({ length: nfkc.length }, (_, i) => i);
    return { mapped: nfkc, n2o: identity, o2n: [...identity] };
  }

  const n2o: number[] = [];
  const o2n: number[] = new Array(original.length).fill(-1);

  let oi = 0;
  let ni = 0;

  while (ni < nfkc.length && oi < original.length) {
    if (nfkc[ni] === original[oi]) {
      n2o.push(oi);
      o2n[oi] = ni;
      ni++;
      oi++;
    } else {
      // NFKC expanded or contracted: try to find a run where
      // re-normalizing the original char produces the nfkc sequence
      const origChar = original[oi]!;
      const origNfkc = origChar.normalize("NFKC");

      if (origNfkc.length > 1 && nfkc.substring(ni, ni + origNfkc.length) === origNfkc) {
        // Expansion: one original char → multiple NFKC chars
        for (let k = 0; k < origNfkc.length; k++) {
          n2o.push(oi);
        }
        o2n[oi] = ni;
        ni += origNfkc.length;
        oi++;
      } else {
        // Single-char replacement or other NFKC transform
        n2o.push(oi);
        o2n[oi] = ni;
        ni++;
        oi++;
      }
    }
  }

  // Fill unmapped original positions
  let lastN = 0;
  for (let j = 0; j < o2n.length; j++) {
    if (o2n[j] === -1) {
      o2n[j] = lastN;
    } else {
      lastN = o2n[j]!;
    }
  }

  return { mapped: nfkc, n2o, o2n };
}
