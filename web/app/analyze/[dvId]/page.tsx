"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { streamAnalysis, checkAnalysisReady } from "@/lib/api";
import type { StageEvent } from "@/lib/api";
import { formatStageLabel, formatStageCounts } from "@/lib/format";

const STREAM_TIMEOUT_MS = 90_000;

interface StageRow {
  event: StageEvent;
  label: string;
  detail: string;
}

function StageIcon({ status }: { status: string }) {
  if (status === "error") {
    return <span className="text-red-600">✗</span>;
  }
  return <span className="text-green-700">✓</span>;
}

function RejectedBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
      {count} rejected — quote not found in document
    </span>
  );
}

export default function AnalyzePage({
  params,
}: {
  params: Promise<{ dvId: string }>;
}) {
  const { dvId } = use(params);
  const router = useRouter();
  const [stages, setStages] = useState<StageRow[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    function settle() {
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
    }

    (async () => {
      try {
        const ready = await checkAnalysisReady(dvId);
        if (ready) {
          router.replace(`/findings/${dvId}`);
          return;
        }
      } catch {
        // findings check failed — proceed with analysis
      }

      timeoutId = setTimeout(async () => {
        if (settled) return;
        try {
          const ready = await checkAnalysisReady(dvId);
          if (ready) {
            settle();
            setDone(true);
            return;
          }
        } catch {
          // ignore
        }
        setTimedOut(true);
      }, STREAM_TIMEOUT_MS);

      try {
        for await (const event of streamAnalysis(dvId, controller.signal)) {
          if (event.stage === "complete") {
            settle();
            setDone(true);
            continue;
          }

          if (event.stage === "error" || event.status === "failed") {
            settle();
            setError(event.error ?? "Unknown error");
            return;
          }

          const label = formatStageLabel(event.stage);
          const detail = formatStageCounts(event);
          setStages((prev) => [...prev, { event, label, detail }]);
        }

        if (!settled) {
          settle();
          setDone(true);
        }
      } catch (err) {
        if (settled) return;
        if (controller.signal.aborted) return;
        settle();
        setError(err instanceof Error ? err.message : "Analysis failed");
      }
    })();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      controller.abort();
    };
  }, [dvId, router]);

  const rejectedCount =
    stages.find((s) => s.event.stage === "verified")?.event.counts.rejected ??
    0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="mt-1 text-sm text-gray-500">
          Document {dvId.slice(0, 8)}…
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100">
          {stages.map((s, i) => (
            <li key={i} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-0.5 flex-shrink-0 text-lg leading-none">
                <StageIcon status={s.event.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-gray-900">{s.label}</span>
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{s.detail}</p>
                {s.event.stage === "verified" && rejectedCount > 0 && (
                  <RejectedBadge count={rejectedCount} />
                )}
              </div>
            </li>
          ))}

          {!done && !error && !timedOut && (
            <li className="flex items-center gap-3 px-5 py-3.5 text-gray-400">
              <span className="mt-0.5 flex-shrink-0 text-lg leading-none animate-pulse">
                ○
              </span>
              <span className="text-sm">Processing…</span>
            </li>
          )}
        </ul>
      </div>

      {timedOut && !done && !error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            Analysis is taking longer than expected.
          </p>
          <p className="mt-1 text-sm text-amber-800">
            The pipeline may have already finished. Check your results or try
            again.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => router.push(`/findings/${dvId}`)}
              className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-800"
            >
              View findings
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-800">Analysis failed: {error}</p>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => router.push(`/findings/${dvId}`)}
              className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-800 transition hover:bg-red-100"
            >
              View findings anyway
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/findings/${dvId}`)}
            className="rounded bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            View findings
          </button>
          <span className="text-sm text-gray-500">
            {stages.length} stages completed
          </span>
        </div>
      )}
    </div>
  );
}
