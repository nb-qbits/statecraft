import type {
  GoldObligation,
  PipelineFinding,
  MatchedPair,
  DocumentReport,
  MatchVerdict,
} from "./types.js";

function normalizeCitationForMatch(citation: string): string {
  return citation
    .replace(/^§§?\s*/, "")
    .replace(/^[Ss]ection\s+/i, "")
    .replace(/^[Ss]ec\.?\s+/i, "")
    .replace(/\s*\([A-Za-z0-9]+\).*$/, "")
    .replace(/\.\s*$/, "")
    .trim()
    .toLowerCase();
}

function normalizeCitationFull(citation: string): string {
  return citation
    .replace(/^§§?\s*/, "")
    .replace(/^[Ss]ection\s+/i, "")
    .replace(/^[Ss]ec\.?\s+/i, "")
    .replace(/\.\s*$/, "")
    .trim()
    .toLowerCase();
}

function normalizeActorForMatch(actor: string): string {
  return actor.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordOverlap(a: string, b: string | null, minWordLen: number): number {
  if (!b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > minWordLen));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > minWordLen));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let intersection = 0;
  for (const w of aWords) {
    if (bWords.has(w)) intersection++;
  }
  return intersection / Math.max(aWords.size, bWords.size);
}

function findingOutcome(f: PipelineFinding): "date" | "bounded" | "refuse" {
  if (f.resolved && f.adjustedDate) return "date";
  if (f.resolved && f.rrule && f.occurrences?.length > 0) return "date";
  if (f.bounded) return "bounded";
  return "refuse";
}

function findingDate(f: PipelineFinding): string | null {
  if (f.resolved && f.adjustedDate) return f.adjustedDate;
  if (f.resolved && f.rrule && f.occurrences?.length > 0) return f.occurrences[0]!.adjustedDate;
  if (f.bounded && f.upperBound) return f.upperBound;
  return null;
}

function isParseError(f: PipelineFinding): boolean {
  return !f.grammarParsed && f.grammarFailureReason !== null;
}

function findingRefusalReason(f: PipelineFinding): string | null {
  if (f.unresolvedReason) return f.unresolvedReason;
  if (f.grammarFailureReason) return `grammar: ${f.grammarFailureReason}`;
  if (f.refusalKind) return f.refusalKind;
  return null;
}

function actorsMatch(goldActor: string, findingActor: string | null): boolean {
  if (!findingActor) return false;
  const g = normalizeActorForMatch(goldActor);
  const f = normalizeActorForMatch(findingActor);
  if (g === f || g.includes(f) || f.includes(g)) return true;
  return wordOverlap(goldActor, findingActor, 3) >= 0.8;
}

function citationsMatch(goldCitation: string, foundCitation: string | null): boolean {
  if (!foundCitation) return false;
  const g = normalizeCitationFull(goldCitation);
  const f = normalizeCitationFull(foundCitation);
  return g === f || g.includes(f) || f.includes(g);
}

interface ScoredMatch {
  goldIdx: number;
  findingIdx: number;
  score: number;
}

export function matchFindings(
  obligations: readonly GoldObligation[],
  findings: readonly PipelineFinding[],
): MatchedPair[] {
  const candidates: ScoredMatch[] = [];

  for (let gi = 0; gi < obligations.length; gi++) {
    const gold = obligations[gi]!;
    const goldCit = normalizeCitationForMatch(gold.citation);

    for (let fi = 0; fi < findings.length; fi++) {
      const finding = findings[fi]!;
      const findingCit = finding.sectionCitation
        ? normalizeCitationForMatch(finding.sectionCitation)
        : "";

      let score = 0;

      const goldActorNorm = normalizeActorForMatch(gold.actor);
      const findingActorNorm = finding.actor
        ? normalizeActorForMatch(finding.actor)
        : "";
      const actorSim = wordOverlap(gold.actor, finding.actor, 3);
      if (actorSim >= 0.8) {
        score += 0.5;
      } else if (
        goldActorNorm && findingActorNorm &&
        (goldActorNorm === findingActorNorm ||
         goldActorNorm.includes(findingActorNorm) ||
         findingActorNorm.includes(goldActorNorm))
      ) {
        score += 0.4;
      } else if (actorSim >= 0.5) {
        score += 0.3;
      }

      const dutySim = wordOverlap(gold.duty, finding.obligationTitle, 3);
      score += dutySim * 0.4;

      if (goldCit && findingCit && goldCit === findingCit) {
        score += 0.2;
      } else if (goldCit && findingCit) {
        if (goldCit.includes(findingCit) || findingCit.includes(goldCit)) {
          score += 0.1;
        } else {
          score -= 0.15;
        }
      }

      if (score >= 0.3) {
        candidates.push({ goldIdx: gi, findingIdx: fi, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedGold = new Set<number>();
  const usedFinding = new Set<number>();
  const pairs: MatchedPair[] = [];

  for (const c of candidates) {
    if (usedGold.has(c.goldIdx) || usedFinding.has(c.findingIdx)) continue;
    usedGold.add(c.goldIdx);
    usedFinding.add(c.findingIdx);

    const gold = obligations[c.goldIdx]!;
    const finding = findings[c.findingIdx]!;
    pairs.push(judgeMatch(gold, finding));
  }

  for (let gi = 0; gi < obligations.length; gi++) {
    if (usedGold.has(gi)) continue;
    const gold = obligations[gi]!;
    pairs.push({
      goldId: gold.id,
      findingAnchorId: null,
      verdict: "unmatched_gold",
      goldActor: gold.actor,
      foundActor: null,
      actorCorrect: false,
      goldDate: gold.expected_date,
      foundDate: null,
      dateCorrect: null,
      goldCitation: gold.citation,
      foundCitation: null,
      citationCorrect: false,
      goldOutcome: gold.expected_outcome,
      foundOutcome: null,
      refusalReason: null,
      detail: `Gold obligation "${gold.duty}" not found in pipeline output`,
    });
  }

  return pairs;
}

function judgeMatch(gold: GoldObligation, finding: PipelineFinding): MatchedPair {
  const outcome = findingOutcome(finding);
  const fDate = findingDate(finding);
  const fRefusal = findingRefusalReason(finding);
  const parseErr = isParseError(finding);

  const actorMatch = actorsMatch(gold.actor, finding.actor);
  const citationMatch = citationsMatch(gold.citation, finding.sectionCitation);
  const dateMatch: boolean | null =
    gold.expected_outcome === "refuse" ? null :
    gold.expected_date === null ? null :
    gold.expected_date === fDate;

  let verdict: MatchVerdict;
  let detail: string;

  if (gold.expected_outcome === "refuse") {
    if (outcome === "refuse" && parseErr) {
      verdict = "parse_error";
      detail = `Gold expects refusal, but system failed before it could decide: ${fRefusal}`;
    } else if (outcome === "refuse") {
      verdict = actorMatch ? "correct_refuse" : "wrong_actor";
      detail = actorMatch
        ? "Correctly refused"
        : `Actor mismatch: expected "${gold.actor}", got "${finding.actor}"`;
    } else {
      verdict = "wrong_date";
      detail = `Expected refusal but got ${outcome}: ${fDate}`;
    }
  } else if (gold.expected_outcome === "date") {
    if (outcome === "refuse" && parseErr) {
      verdict = "parse_error";
      detail = `Expected date ${gold.expected_date} but grammar parse failed: ${fRefusal}`;
    } else if (outcome === "refuse") {
      verdict = "refused_but_shouldnt_have";
      detail = `Expected date ${gold.expected_date} but system refused: ${fRefusal}`;
    } else if (outcome === "bounded") {
      verdict = "refused_but_shouldnt_have";
      detail = `Expected exact date ${gold.expected_date} but got bounded: upper=${fDate}`;
    } else {
      const dMatch = gold.expected_date === fDate;
      if (dMatch && actorMatch) {
        verdict = "correct_date";
        detail = "Date and actor correct";
      } else if (!dMatch) {
        verdict = "wrong_date";
        detail = `Date mismatch: expected ${gold.expected_date}, got ${fDate}`;
      } else {
        verdict = "wrong_actor";
        detail = `Actor mismatch: expected "${gold.actor}", got "${finding.actor}"`;
      }
    }
  } else {
    // bounded
    if (outcome === "refuse" && parseErr) {
      verdict = "parse_error";
      detail = `Expected bounded ≤${gold.expected_date} but grammar parse failed: ${fRefusal}`;
    } else if (outcome === "refuse" && !finding.bounded) {
      verdict = "refused_but_shouldnt_have";
      detail = `Expected bounded (≤${gold.expected_date}) but system refused: ${fRefusal}`;
    } else if (outcome === "bounded" || outcome === "date") {
      const dMatch = gold.expected_date === fDate;
      if (dMatch && actorMatch) {
        verdict = outcome === "bounded" ? "correct_bounded" : "correct_date";
        detail = outcome === "bounded"
          ? `Bounded correctly: ≤${fDate}`
          : `Resolved to exact date ${fDate} (better than expected bound)`;
      } else if (!dMatch) {
        verdict = "wrong_date";
        detail = `Date mismatch: expected ≤${gold.expected_date}, got ${outcome === "bounded" ? "≤" : ""}${fDate}`;
      } else {
        verdict = "wrong_actor";
        detail = `Actor mismatch: expected "${gold.actor}", got "${finding.actor}"`;
      }
    } else {
      verdict = "refused_but_shouldnt_have";
      detail = `Expected bounded ≤${gold.expected_date} but system refused: ${fRefusal}`;
    }
  }

  return {
    goldId: gold.id,
    findingAnchorId: finding.anchorId,
    verdict,
    goldActor: gold.actor,
    foundActor: finding.actor,
    actorCorrect: actorMatch,
    goldDate: gold.expected_date,
    foundDate: fDate,
    dateCorrect: dateMatch,
    goldCitation: gold.citation,
    foundCitation: finding.sectionCitation,
    citationCorrect: citationMatch,
    goldOutcome: gold.expected_outcome,
    foundOutcome: outcome,
    refusalReason: fRefusal,
    detail,
  };
}

export function buildDocumentReport(
  documentName: string,
  verified: boolean,
  obligations: readonly GoldObligation[],
  findings: readonly PipelineFinding[],
): DocumentReport {
  const pairs = matchFindings(obligations, findings);

  const matched = pairs.filter(
    p => p.verdict !== "unmatched_gold" && p.verdict !== "unmatched_finding",
  );
  const labelled = obligations.length;
  const found = findings.length;

  const recall = labelled > 0 ? matched.length / labelled : 0;

  const actorCorrectCount = matched.filter(p => p.actorCorrect).length;
  const actorAccuracy = matched.length > 0 ? actorCorrectCount / matched.length : 0;

  const citationCorrectCount = matched.filter(p => p.citationCorrect).length;
  const citationAccuracy = matched.length > 0 ? citationCorrectCount / matched.length : 0;

  const dateAssessable = matched.filter(p => p.dateCorrect !== null);
  const dateCorrectCount = dateAssessable.filter(p => p.dateCorrect === true).length;
  const dateAccuracy = dateAssessable.length > 0 ? dateCorrectCount / dateAssessable.length : 0;

  const completeCorrect = matched.filter(p =>
    p.actorCorrect && p.citationCorrect && p.dateCorrect === true,
  ).length;
  const completeRecords = matched.length > 0 ? completeCorrect / matched.length : 0;

  const wrongAnswers = pairs.filter(p =>
    p.verdict === "wrong_date" ||
    p.verdict === "wrong_actor" ||
    p.verdict === "wrong_citation",
  );

  const refusedButShouldntHave = pairs.filter(p =>
    p.verdict === "refused_but_shouldnt_have",
  );

  const parseErrors = pairs.filter(p => p.verdict === "parse_error");

  const unmatchedGold = pairs.filter(p => p.verdict === "unmatched_gold");

  const matchedAnchorIds = new Set(pairs.map(p => p.findingAnchorId).filter(Boolean));
  const unmatchedFindings = findings
    .filter(f => !matchedAnchorIds.has(f.anchorId))
    .map(f => f.anchorId);

  return {
    documentName,
    verified,
    labelled,
    found,
    matched: matched.length,
    recall,
    actorAccuracy,
    citationAccuracy,
    dateAccuracy,
    completeRecords,
    wrongAnswers,
    refusedButShouldntHave,
    parseErrors,
    unmatchedGold,
    unmatchedFindings,
    pairs,
  };
}
