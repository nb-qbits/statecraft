"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument, streamAnalysis } from "@/lib/api";
import type { LegalIdentity, StageEvent } from "@/lib/api";
import { addStoredBill } from "@/lib/docket-data";

const PROCESSING_STAGES = [
  { label: "Parsing the document", key: "parsed" },
  { label: "Scanning for deadline language", key: "scanned" },
  { label: "AI identifying candidate obligations", key: "proposed" },
  { label: "Verifying each quote against the source text", key: "verified" },
  { label: "Computing dates under applicable rules", key: "resolved" },
];

function formatStageDetail(key: string, counts: Record<string, number>): string {
  switch (key) {
    case "parsed":
      return counts.provisions ? `${counts.provisions} sections found` : "";
    case "scanned":
      return counts.candidateExpressions
        ? `${counts.candidateExpressions} candidate expressions`
        : "";
    case "proposed":
      return counts.spansIdentified
        ? `${counts.spansIdentified} spans identified`
        : "";
    case "verified": {
      const parts: string[] = [];
      if (counts.anchoredToSource) parts.push(`${counts.anchoredToSource} anchored`);
      if (counts.rejected) parts.push(`${counts.rejected} rejected`);
      return parts.join(", ");
    }
    case "resolved": {
      const parts: string[] = [];
      if (counts.datesComputed) parts.push(`${counts.datesComputed} dates computed`);
      if (counts.needTriggerDate) parts.push(`${counts.needTriggerDate} need input`);
      return parts.join(", ");
    }
    default:
      return "";
  }
}

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function StageRow({
  label,
  index,
  currentStep,
  detail,
}: {
  label: string;
  index: number;
  currentStep: number;
  detail: string;
}) {
  const done = currentStep > index;
  const active = currentStep === index;
  return (
    <div
      className="flex items-start gap-3"
      style={{
        padding: "10px 0",
        opacity: !done && !active ? 0.45 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
        style={{
          background: done ? "#3F6B54" : active ? "#C8983E" : "#EDEDF0",
          color: done || active ? "#fff" : "#AEAEB2",
          transition: "background 0.3s ease",
        }}
      >
        {done ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          index + 1
        )}
      </div>
      <div className="min-w-0 pt-0.5">
        <div
          style={{
            fontSize: "15px",
            color: done ? "#3F6B54" : active ? "#1D1D1F" : "#AEAEB2",
            fontWeight: active ? 600 : done ? 500 : 400,
            transition: "color 0.3s ease",
          }}
        >
          {label}
        </div>
        {done && detail && (
          <div
            style={{
              fontSize: "13px",
              color: "#86868B",
              marginTop: "2px",
            }}
          >
            {detail}
          </div>
        )}
        {active && (
          <div className="mt-1.5 flex items-center gap-2">
            <div
              style={{
                width: "80px",
                height: "3px",
                borderRadius: "2px",
                background: "#EDEDF0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: "2px",
                  background: "#C8983E",
                  animation: "shimmer 1.8s ease-in-out infinite",
                }}
              />
            </div>
            <span style={{ fontSize: "13px", color: "#AEAEB2" }}>
              Working...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddBillPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [stageDetails, setStageDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastDvId, setLastDvId] = useState<string | null>(null);
  const elapsed = useElapsed(processing);

  const [jurisdiction, setJurisdiction] = useState("us-fed");
  const [session, setSession] = useState("");
  const [instrumentType, setInstrumentType] = useState("bill");
  const [billNumber, setBillNumber] = useState("");
  const [stage, setStage] = useState("introduced");

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const handleFile = (f: File) => {
    setFile(f);
    setError(null);
    const name = f.name.replace(/\.[^.]+$/, "");
    if (!billNumber) setBillNumber(name);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [billNumber],
  );

  const runAnalysis = async (dvId: string) => {
    const stageMap: Record<string, number> = {
      parsed: 0,
      scanned: 1,
      proposed: 2,
      verified: 3,
      parsedDates: 4,
      resolved: 4,
      routed: 4,
    };

    for await (const event of streamAnalysis(dvId)) {
      const step = stageMap[event.stage];
      if (step !== undefined) {
        const stageKey = PROCESSING_STAGES[step]?.key ?? event.stage;
        const detail = formatStageDetail(stageKey, event.counts);
        if (detail) {
          setStageDetails((prev) => ({ ...prev, [stageKey]: detail }));
        }
        setCurrentStep(step + 1);
      }
      if (event.stage === "complete") {
        setCurrentStep(5);
        setTimeout(() => router.push(`/docket/bill/${dvId}`), 800);
        return;
      }
      if (event.status === "failed") {
        setError(event.error ?? "Analysis failed. Please try again.");
        setProcessing(false);
        return;
      }
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setError(null);
    setProcessing(true);
    setCurrentStep(0);
    setStageDetails({});

    try {
      const identity: LegalIdentity = {
        jurisdiction,
        session: session || "2026",
        instrumentType,
        number: billNumber || file.name,
        stage,
        chapter: null,
      };

      const result = await uploadDocument(file, identity);
      const dvId = result.documentVersionId;
      setLastDvId(dvId);
      addStoredBill(dvId);

      await runAnalysis(dvId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProcessing(false);
    }
  };

  const handleRetry = async () => {
    if (!lastDvId) return;
    setError(null);
    setProcessing(true);
    setCurrentStep(0);
    setStageDetails({});

    try {
      await runAnalysis(lastDvId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
      setProcessing(false);
    }
  };

  if (processing) {
    const allDone = currentStep >= PROCESSING_STAGES.length;
    return (
      <>
        <div
          className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-10 md:py-5"
          style={{ borderColor: "#E5E5EA" }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "#16233F",
            }}
          >
            Analyzing
          </div>
          <div className="text-[14px]" style={{ color: "#6E6E73" }}>
            {today}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-lg">
            {/* Header */}
            <div className="mb-2 text-center">
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "#16233F",
                  fontFamily: "var(--font-heading)",
                  letterSpacing: "-0.02em",
                }}
              >
                {allDone ? "Analysis complete" : "Processing your bill"}
              </div>
              {file && (
                <div style={{ fontSize: "14px", color: "#86868B", marginTop: "6px" }}>
                  {file.name}
                  {!error && (
                    <span style={{ color: "#AEAEB2" }}> &middot; {elapsed}</span>
                  )}
                </div>
              )}
            </div>

            {/* Overall progress bar */}
            <div
              style={{
                margin: "20px 0 24px",
                height: "4px",
                borderRadius: "2px",
                background: "#EDEDF0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: "2px",
                  background: allDone ? "#3F6B54" : "#C8983E",
                  width: `${Math.min(100, (currentStep / PROCESSING_STAGES.length) * 100)}%`,
                  transition: "width 0.5s cubic-bezier(.16,1,.3,1), background 0.3s ease",
                }}
              />
            </div>

            {/* Stages */}
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #EDEDF0",
                borderRadius: "12px",
                padding: "6px 20px",
              }}
            >
              {PROCESSING_STAGES.map((s, i) => (
                <StageRow
                  key={s.key}
                  label={s.label}
                  index={i}
                  currentStep={currentStep}
                  detail={stageDetails[s.key] ?? ""}
                />
              ))}
            </div>

            {error && (
              <div
                className="mt-5 rounded-[10px] border px-5 py-4"
                style={{
                  borderColor: "#E5C5BF",
                  background: "#FBEAE5",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#B8452F", marginBottom: "4px" }}>
                  Something went wrong
                </div>
                <div style={{ fontSize: "14px", color: "#B8452F", lineHeight: "1.5" }}>
                  {error}
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  {lastDvId && (
                    <button
                      onClick={handleRetry}
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#fff",
                        background: "#B8452F",
                        border: "none",
                        borderRadius: "8px",
                        padding: "6px 14px",
                        cursor: "pointer",
                      }}
                    >
                      Retry analysis
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setProcessing(false);
                      setCurrentStep(-1);
                      setStageDetails({});
                      setError(null);
                      setLastDvId(null);
                    }}
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#B8452F",
                      background: "none",
                      border: "1px solid #D4A09A",
                      borderRadius: "8px",
                      padding: "6px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Start over
                  </button>
                </div>
              </div>
            )}

            {!error && !allDone && (
              <div
                className="mt-4 text-center"
                style={{ fontSize: "13px", color: "#AEAEB2" }}
              >
                This typically takes 15–45 seconds depending on document length.
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-10 md:py-5"
        style={{ borderColor: "#E5E5EA" }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "30px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Add a bill
        </div>
        <div style={{ fontSize: "14px", color: "#6E6E73", fontFamily: "var(--font-body)" }}>
          Today — {today}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 md:p-8">
        <p className="mb-6 text-[15px] leading-relaxed" style={{ color: "#1D1D1F" }}>
          Every deadline is matched to the exact section it comes from and the
          agency or office responsible — nothing is guessed.
        </p>

        <div className="mb-6">
          <div
            className="mb-4 inline-flex gap-0.5 rounded-[11px] p-[3px]"
            style={{ background: "#F0F0F2" }}
          >
            <button
              onClick={() => setUploadMode("file")}
              className="rounded-[9px] px-[18px] py-2 text-[15px] font-semibold"
              style={{
                background: uploadMode === "file" ? "#fff" : "transparent",
                color: uploadMode === "file" ? "#16233F" : "#6E6E73",
                boxShadow:
                  uploadMode === "file"
                    ? "0 1px 3px rgba(0,0,0,0.08)"
                    : "none",
              }}
            >
              Upload file
            </button>
            <button
              onClick={() => setUploadMode("url")}
              className="rounded-[9px] px-[18px] py-2 text-[15px] font-semibold"
              style={{
                background: uploadMode === "url" ? "#fff" : "transparent",
                color: uploadMode === "url" ? "#16233F" : "#6E6E73",
                boxShadow:
                  uploadMode === "url"
                    ? "0 1px 3px rgba(0,0,0,0.08)"
                    : "none",
              }}
            >
              Paste URL
            </button>
          </div>

          {uploadMode === "file" ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors"
              style={{
                borderColor: dragging ? "#C8983E" : "#E5E5EA",
                background: dragging ? "#FBF7F0" : "#FAFAFB",
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#AEAEB2"
                strokeWidth="1.5"
                className="mb-3"
              >
                <path d="M12 5v14M5 12l7-7 7 7" />
              </svg>
              {file ? (
                <div>
                  <div className="text-[15px] font-medium" style={{ color: "#1D1D1F" }}>
                    {file.name}
                  </div>
                  <div className="mt-1 text-[13px]" style={{ color: "#86868B" }}>
                    Click or drop to replace
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[15px]" style={{ color: "#1D1D1F" }}>
                    Drop a bill here, or click to browse
                  </div>
                  <div className="mt-1 text-[13px]" style={{ color: "#86868B" }}>
                    PDF, DOCX, or plain text
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          ) : (
            <div className="rounded-xl border p-4" style={{ borderColor: "#E5E5EA", background: "#FAFAFB" }}>
              <label className="mb-2 block text-[13px] font-medium" style={{ color: "#86868B" }}>
                Paste a URL to the bill text
              </label>
              <input
                type="url"
                placeholder="https://..."
                className="w-full rounded-lg border px-3 py-2.5 text-[15px]"
                style={{ borderColor: "#E5E5EA" }}
              />
              <p className="mt-2 text-[13px]" style={{ color: "#AEAEB2" }}>
                URL import is not yet available. Please upload a file instead.
              </p>
            </div>
          )}
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium" style={{ color: "#86868B" }}>
              Jurisdiction
            </label>
            <select
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-[15px]"
              style={{ borderColor: "#E5E5EA" }}
            >
              <option value="us-va">Virginia</option>
              <option value="us-fed">Federal</option>
              <option value="us-ca">California</option>
              <option value="us-tx">Texas</option>
              <option value="us-ny">New York</option>
              <option value="us-fl">Florida</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium" style={{ color: "#86868B" }}>
              Session / Congress
            </label>
            <input
              value={session}
              onChange={(e) => setSession(e.target.value)}
              placeholder="e.g. 2026 Regular Session"
              className="w-full rounded-lg border px-3 py-2.5 text-[15px]"
              style={{ borderColor: "#E5E5EA" }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium" style={{ color: "#86868B" }}>
              Bill number
            </label>
            <input
              value={billNumber}
              onChange={(e) => setBillNumber(e.target.value)}
              placeholder="e.g. HB 35"
              className="w-full rounded-lg border px-3 py-2.5 text-[15px]"
              style={{ borderColor: "#E5E5EA" }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium" style={{ color: "#86868B" }}>
              Stage
            </label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-[15px]"
              style={{ borderColor: "#E5E5EA" }}
            >
              <option value="introduced">Introduced</option>
              <option value="enrolled">Enrolled</option>
              <option value="enacted">Enacted</option>
            </select>
          </div>
        </div>

        {error && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 text-[15px]"
            style={{
              borderColor: "#E5C5BF",
              background: "#FBEAE5",
              color: "#B8452F",
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={!file}
          className="rounded-[10px] px-8 py-3 text-[15px] font-semibold transition-transform active:scale-[0.97] disabled:opacity-40"
          style={{ background: "#16233F", color: "#F5F2E8" }}
        >
          Analyze bill
        </button>
      </div>
    </>
  );
}
