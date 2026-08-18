"use client";

import { useEffect, useState, useCallback, use } from "react";
import { fetchFindings, streamAnalysis } from "@/lib/api";
import type { Finding, FindingsResponse, SuppressedSpan, FindingOccurrence, EngineVersions, LegalIdentity } from "@/lib/api";
import {
  formatUnresolvedReason,
  formatDate,
  formatLane,
  formatKind,
  formatRejectionReason,
  formatRruleSchedule,
} from "@/lib/format";

const JURISDICTION_NAMES: Record<string, string> = {
  "us-va": "Virginia", "us-ca": "California", "us-ny": "New York",
  "us-tx": "Texas", "us-fl": "Florida", "us-il": "Illinois",
  "us-pa": "Pennsylvania", "us-oh": "Ohio", "us-ga": "Georgia",
  "us-nc": "North Carolina", "us-md": "Maryland", "us-co": "Colorado",
  "us-mn": "Minnesota", "us-wa": "Washington", "us-or": "Oregon",
  "us-ma": "Massachusetts", "us-ct": "Connecticut", "us-nj": "New Jersey",
};

function formatDocumentTitle(identity: LegalIdentity): string {
  const name = identity.chapter
    ? `Chapter ${identity.chapter}`
    : `${identity.instrumentType} ${identity.number}`;
  const jurisdiction = JURISDICTION_NAMES[identity.jurisdiction] ?? identity.jurisdiction;
  const subtitle = identity.shortTitle ?? jurisdiction;
  return `${name} (${identity.session}) — ${subtitle}`;
}

function OccurrenceRow({ occ }: { occ: FindingOccurrence }) {
  const adjusted = occ.occurrenceDate !== occ.adjustedDate;
  const adjustCitation = adjusted
    ? occ.citations.find((c) => c.includes("§ 1-210"))
    : null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        <span className="font-medium text-gray-900">
          {formatDate(occ.adjustedDate)}
        </span>
        {adjusted && (
          <span className="ml-2 text-xs text-amber-700">
            statutory {formatDate(occ.occurrenceDate)} adjusted
            {adjustCitation ? ` per ${adjustCitation}` : ""}
          </span>
        )}
      </div>
      <span className="flex-shrink-0 text-xs text-gray-400">
        #{occ.sequenceNumber}
      </span>
    </div>
  );
}

function RecurrenceCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const schedule = finding.rrule ? formatRruleSchedule(finding.rrule) : "";
  const isEstimated = finding.dateProvenance === "generic_default";

  const now = new Date().toISOString().slice(0, 10);
  const upcoming = finding.occurrences.filter((o) => o.adjustedDate >= now);
  const nextOcc = upcoming[0] ?? finding.occurrences[0];

  return (
    <div className={`rounded-lg border px-5 py-4 ${
      isEstimated
        ? "border-amber-200 bg-amber-50/30"
        : "border-indigo-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-gray-900">
              {finding.provisionLabel || finding.structuralPath}
            </span>
            <span className="text-xs text-gray-400">
              {formatKind(finding.kind)}
            </span>
          </div>

          <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-800">
            {"“"}
            {finding.quotedText}
            {"”"}
          </blockquote>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-gray-900">
                {schedule.charAt(0).toUpperCase() + schedule.slice(1)}
              </span>
            </div>

            {isEstimated && (
              <p className="text-xs font-medium text-amber-700">
                Estimated — not verified for this jurisdiction
              </p>
            )}

            {nextOcc && (
              <p className="text-sm text-gray-700">
                Next occurrence:{" "}
                <span className="font-medium">{formatDate(nextOcc.adjustedDate)}</span>
                {nextOcc.occurrenceDate !== nextOcc.adjustedDate && (
                  <span className="ml-1 text-xs text-amber-700">
                    (adjusted from {formatDate(nextOcc.occurrenceDate)})
                  </span>
                )}
              </p>
            )}

            {finding.occurrences.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {expanded ? "Hide" : "Show"} {finding.occurrences.length} upcoming occurrences
                  {finding.horizon && (
                    <span className="ml-1 font-normal text-gray-400">
                      (through {formatDate(finding.horizon)})
                    </span>
                  )}
                </button>

                {expanded && (
                  <div className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200 bg-gray-50 px-3 py-1">
                    {finding.occurrences.map((occ) => (
                      <OccurrenceRow key={occ.sequenceNumber} occ={occ} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-gray-500">
              {finding.citations.join(" · ")}
            </p>
          </div>
        </div>

        <span className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          isEstimated
            ? "bg-amber-100 text-amber-800"
            : "bg-indigo-100 text-indigo-700"
        }`}>
          {isEstimated ? "estimated recurring" : "recurring"}
        </span>
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  if (finding.rrule && finding.occurrences.length > 0) {
    return <RecurrenceCard finding={finding} />;
  }

  const isEstimated = finding.dateProvenance === "generic_default";

  return (
    <div className={`rounded-lg border px-5 py-4 ${
      isEstimated
        ? "border-amber-200 bg-amber-50/30"
        : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-gray-900">
              {finding.provisionLabel || finding.structuralPath}
            </span>
            <span className="text-xs text-gray-400">
              {formatKind(finding.kind)}
            </span>
          </div>

          <blockquote className="border-l-2 border-gray-300 pl-3 text-sm text-gray-800">
            {"“"}
            {finding.quotedText}
            {"”"}
          </blockquote>

          {finding.resolved && finding.statutoryDate ? (
            <div className="space-y-1">
              <p className="text-base font-semibold text-gray-900">
                {formatDate(finding.statutoryDate)}
                {finding.adjustedDate &&
                  finding.adjustedDate !== finding.statutoryDate && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      adjusted to {formatDate(finding.adjustedDate)}
                    </span>
                  )}
              </p>
              {isEstimated && (
                <p className="text-xs font-medium text-amber-700">
                  Estimated — not verified for this jurisdiction
                </p>
              )}
              <p className="text-xs text-gray-500">
                {finding.citations.join(" · ")}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm text-gray-700">
                {formatUnresolvedReason(finding)}
              </p>
            </div>
          )}
        </div>

        <span
          className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            isEstimated
              ? "bg-amber-100 text-amber-800"
              : finding.resolved
                ? "bg-gray-100 text-gray-700"
                : "bg-gray-100 text-gray-600"
          }`}
        >
          {isEstimated ? "estimated" : finding.resolved ? "resolved" : "unresolved"}
        </span>
      </div>
    </div>
  );
}

function LaneGroup({
  lane,
  findings,
}: {
  lane: string;
  findings: Finding[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          {formatLane(lane)}
        </h2>
        <span className="text-sm text-gray-500">
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>
      <div className="space-y-3">
        {findings.map((f) => (
          <FindingCard key={f.anchorId} finding={f} />
        ))}
      </div>
    </section>
  );
}

const SUPPORTED_PACKS = new Set(["us-va"]);

function JurisdictionLimitationNotice({ jurisdiction }: { jurisdiction: string }) {
  if (SUPPORTED_PACKS.has(jurisdiction)) return null;
  const isFederal = jurisdiction === "us-fed";
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
      <p className="text-sm font-medium text-blue-900">
        {isFederal
          ? "Federal legislation: limited support"
          : `Jurisdiction ${JURISDICTION_NAMES[jurisdiction] ?? jurisdiction}: limited support`}
      </p>
      <p className="mt-1 text-xs text-blue-800">
        {isFederal
          ? "Federal bills are parsed and spans are extracted, but statutory date computation requires a jurisdiction pack that does not yet exist for federal legislation. Dates that depend on session calendars, holiday schedules, or enactment-date rules cannot be resolved."
          : `This jurisdiction does not yet have a jurisdiction pack. Spans are extracted and parsed, but statutory date computation is not available.`}{" "}
        All findings below reflect what the engine could determine without jurisdiction-specific rules.
      </p>
    </div>
  );
}

function CoverageSection({
  coverage,
}: {
  coverage: FindingsResponse["coverage"];
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Coverage
      </h2>
      <p className="mt-2 text-2xl font-semibold text-gray-900">
        {coverage.totalSegments} of {coverage.totalSegments} provisions examined
      </p>
      <dl className="mt-2 space-y-0.5 text-sm text-gray-600">
        <div>
          {coverage.withCandidates} contained date or obligation language —
          analysed
        </div>
        <div>
          {coverage.screenedNoCandidate} contained none — screened, no candidate
        </div>
      </dl>
      <p className="mt-3 text-xs text-gray-400">
        This is processing coverage: what was examined. It is not a claim about
        how many deadlines exist in this document.
      </p>
    </section>
  );
}

function RejectedSpansSection({
  spans,
}: {
  spans: FindingsResponse["rejectedSpans"];
}) {
  if (spans.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Rejected spans</h2>
      <p className="text-sm text-gray-600">
        The model proposed these as deadline language, but they could not be
        verified against the document text.
      </p>
      <div className="space-y-2">
        {spans.map((s, i) => (
          <div
            key={i}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <blockquote className="text-sm text-gray-800">
              {"“"}
              {s.quotedText}
              {"”"}
            </blockquote>
            <p className="mt-1 text-xs text-amber-700">{formatRejectionReason(s.reason)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SuppressedSpansSection({
  spans,
}: {
  spans: SuppressedSpan[];
}) {
  if (spans.length === 0) return null;
  const duplicates = spans.filter((s) => s.reason === "duplicate_span");
  const overExtracted = spans.filter(
    (s) => s.reason === "over_extraction_substring",
  );
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Suppressed spans</h2>
      <p className="text-sm text-gray-600">
        {duplicates.length > 0 &&
          `${duplicates.length} duplicate ${duplicates.length === 1 ? "span" : "spans"} collapsed. `}
        {overExtracted.length > 0 &&
          `${overExtracted.length} ${overExtracted.length === 1 ? "fragment" : "fragments"} suppressed as subsets of longer spans.`}
      </p>
      <div className="space-y-2">
        {overExtracted.map((s, i) => (
          <div
            key={`oe-${i}`}
            className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
          >
            <blockquote className="text-sm text-gray-800">
              {"“"}
              {s.quotedText}
              {"”"}
            </blockquote>
            {s.containedBy && (
              <p className="mt-1 text-xs text-gray-500">
                Subset of: {"“"}{s.containedBy}{"”"}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryBar({ data, dvId }: { data: FindingsResponse; dvId: string }) {
  const resolved = data.findings.filter((f) => f.resolved).length;
  const unresolved = data.findings.length - resolved;
  const hasRecords = data.findings.some((f) => f.resolved);

  return (
    <div className="flex flex-wrap items-center gap-6 text-sm">
      <div>
        <span className="text-2xl font-semibold text-gray-900">
          {data.findings.length}
        </span>{" "}
        <span className="text-gray-500">
          {data.findings.length === 1 ? "finding" : "findings"}
        </span>
      </div>
      <div>
        <span className="text-2xl font-semibold text-gray-900">
          {resolved}
        </span>{" "}
        <span className="text-gray-500">resolved</span>
      </div>
      <div>
        <span className="text-2xl font-semibold text-gray-900">
          {unresolved}
        </span>{" "}
        <span className="text-gray-500">unresolved</span>
      </div>
      {data.rejectedSpans.length > 0 && (
        <div>
          <span className="text-2xl font-semibold text-gray-900">
            {data.rejectedSpans.length}
          </span>{" "}
          <span className="text-gray-500">rejected</span>
        </div>
      )}
      <a
        href={`/plan/${dvId}`}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        View plan
      </a>
      {hasRecords && (
        <a
          href={`/api/v1/documents/${dvId}/export/ics`}
          download
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
          </svg>
          Export .ics
        </a>
      )}
    </div>
  );
}

const STAGE_DISPLAY: Record<string, string> = {
  parser: "document parser",
  scanner: "candidate scanner",
  extractor: "obligation extractor",
  anchorer: "quote anchorer",
  grammar: "date parser",
  resolver: "date resolver",
  evaluator: "support evaluator",
  router: "lane router",
  review: "review workflow",
};

function StaleBanner({
  engineVersions,
  dvId,
  onReanalysed,
}: {
  engineVersions: EngineVersions;
  dvId: string;
  onReanalysed: () => void;
}) {
  const [reanalysing, setReanalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (engineVersions.staleStages.length === 0) return null;

  const hasSpecificStages =
    engineVersions.staleStages.length > 0 &&
    !engineVersions.staleStages.includes("unknown");
  const stageNames = hasSpecificStages
    ? engineVersions.staleStages.map((s) => STAGE_DISPLAY[s] ?? s).join(", ")
    : null;

  const parserIsStale = engineVersions.staleStages.includes("parser");

  const handleReanalyse = async (forceReparse = false) => {
    setReanalysing(true);
    setError(null);
    try {
      for await (const event of streamAnalysis(dvId, undefined, { forceReparse })) {
        if (event.stage === "complete") break;
        if (event.status === "failed") {
          setError(event.error ?? "Re-analysis failed");
          setReanalysing(false);
          return;
        }
      }
      setReanalysing(false);
      onReanalysed();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Re-analysis failed";
      if (msg.includes("ACCEPTED_RECORDS_EXIST")) {
        setError("Cannot re-extract: accepted findings must be reverted first.");
      } else {
        setError(msg);
      }
      setReanalysing(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            {parserIsStale
              ? "This document was extracted with an older version of the parser."
              : "This analysis used an earlier version of the engine."}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {stageNames
              ? `Updated since this analysis: ${stageNames}.`
              : "The engine has been updated since this analysis was run."}{" "}
            {parserIsStale
              ? "Re-extract from source to apply parser improvements."
              : "Re-analyse to get results from the current engine."}
          </p>
          {error && (
            <p className="mt-1 text-xs text-red-700">{error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleReanalyse(parserIsStale)}
          disabled={reanalysing}
          className="flex-shrink-0 rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {reanalysing
            ? (parserIsStale ? "Re-extracting…" : "Re-analysing…")
            : (parserIsStale ? "Re-extract from source" : "Re-analyse")}
        </button>
      </div>
    </div>
  );
}

const LANE_ORDER = [
  "exception_review",
  "quick_confirmation",
  "straight_through",
  "blocked",
];

export default function FindingsPage({
  params,
}: {
  params: Promise<{ dvId: string }>;
}) {
  const { dvId } = use(params);
  const [data, setData] = useState<FindingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshData = useCallback(() => {
    fetchFindings(dvId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [dvId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-gray-500">Loading findings...</p>;
  }

  const byLane = new Map<string, Finding[]>();
  for (const f of data.findings) {
    const list = byLane.get(f.lane) ?? [];
    list.push(f);
    byLane.set(f.lane, list);
  }

  const lanes = LANE_ORDER.filter((l) => byLane.has(l));
  for (const l of byLane.keys()) {
    if (!lanes.includes(l)) lanes.push(l);
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="mt-1 text-sm text-gray-500">
          {formatDocumentTitle(data.legalIdentity)}
        </p>
      </div>

      {data.engineVersions &&
        data.engineVersions.staleStages.length > 0 && (
          <StaleBanner
            engineVersions={data.engineVersions}
            dvId={dvId}
            onReanalysed={refreshData}
          />
        )}

      <JurisdictionLimitationNotice jurisdiction={data.legalIdentity.jurisdiction} />

      <SummaryBar data={data} dvId={dvId} />

      <CoverageSection coverage={data.coverage} />

      <RejectedSpansSection spans={data.rejectedSpans} />

      <SuppressedSpansSection spans={data.suppressedSpans} />

      {lanes.map((lane) => (
        <LaneGroup key={lane} lane={lane} findings={byLane.get(lane)!} />
      ))}
    </div>
  );
}
