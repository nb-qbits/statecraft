"use client";

import { useEffect, useState, use } from "react";
import { fetchFindings } from "@/lib/api";
import type { Finding, FindingsResponse, SuppressedSpan } from "@/lib/api";
import {
  formatUnresolvedReason,
  formatDate,
  formatLane,
  formatKind,
  formatRejectionReason,
} from "@/lib/format";

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
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
            finding.resolved
              ? "bg-gray-100 text-gray-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {finding.resolved ? "resolved" : "unresolved"}
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

function SummaryBar({ data }: { data: FindingsResponse }) {
  const resolved = data.findings.filter((f) => f.resolved).length;
  const unresolved = data.findings.length - resolved;
  return (
    <div className="flex flex-wrap gap-6 text-sm">
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

  useEffect(() => {
    fetchFindings(dvId)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [dvId]);

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-gray-500">Loading findings…</p>;
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
          Document {dvId.slice(0, 8)}…
        </p>
      </div>

      <SummaryBar data={data} />

      <CoverageSection coverage={data.coverage} />

      <RejectedSpansSection spans={data.rejectedSpans} />

      <SuppressedSpansSection spans={data.suppressedSpans} />

      {lanes.map((lane) => (
        <LaneGroup key={lane} lane={lane} findings={byLane.get(lane)!} />
      ))}
    </div>
  );
}
