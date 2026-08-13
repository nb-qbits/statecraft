"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument } from "@/lib/api";
import type { LegalIdentity } from "@/lib/api";

function detectIdentity(filename: string): Partial<LegalIdentity> {
  const lower = filename.toLowerCase();
  const result: Partial<LegalIdentity> = {
    jurisdiction: "Virginia",
    session: "2026",
    stage: "enrolled",
    chapter: null,
  };

  const typeMatch = lower.match(/\b(hb|sb|hj|sj)\s*(\d+)/i);
  if (typeMatch) {
    result.instrumentType = typeMatch[1]!.toUpperCase();
    result.number = `${result.instrumentType}${typeMatch[2]}`;
  }

  return result;
}

export default function UploadPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jurisdiction, setJurisdiction] = useState("Virginia");
  const [session, setSession] = useState("2026");
  const [instrumentType, setInstrumentType] = useState("HB");
  const [number, setNumber] = useState("");
  const [stage, setStage] = useState("enrolled");

  const onFile = useCallback((f: File) => {
    setFile(f);
    setError(null);
    const detected = detectIdentity(f.name);
    if (detected.instrumentType) setInstrumentType(detected.instrumentType);
    if (detected.number) setNumber(detected.number);
    if (detected.jurisdiction) setJurisdiction(detected.jurisdiction);
    if (detected.session) setSession(detected.session);
    if (detected.stage) setStage(detected.stage);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!file) return;

      const identity: LegalIdentity = {
        jurisdiction,
        session,
        instrumentType,
        number: number || file.name.replace(/\.[^.]+$/, ""),
        stage,
        chapter: null,
      };

      setUploading(true);
      setError(null);

      try {
        const result = await uploadDocument(file, identity);
        router.push(`/analyze/${result.documentVersionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setUploading(false);
      }
    },
    [file, jurisdiction, session, instrumentType, number, stage, router],
  );

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Analyze legislation
        </h1>
        <p className="text-gray-600">
          Extracts deadlines from legislation. Every date traces to quoted
          source text and cites the statute that computed it.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-16 transition ${
            dragging
              ? "border-blue-400 bg-blue-50"
              : file
                ? "border-gray-300 bg-gray-50"
                : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          {file ? (
            <div className="text-center">
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="mt-1 text-sm text-gray-500">
                {(file.size / 1024).toFixed(0)} KB — click or drop to replace
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="font-medium text-gray-700">
                Drop a bill here, or click to browse
              </p>
              <p className="mt-1 text-sm text-gray-500">
                PDF, DOCX, or plain text
              </p>
            </div>
          )}
        </div>

        <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <legend className="col-span-full mb-2 text-sm font-medium text-gray-700">
            Legal identity
          </legend>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Jurisdiction</span>
            <input
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Session</span>
            <input
              type="text"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Type</span>
            <select
              value={instrumentType}
              onChange={(e) => setInstrumentType(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="HB">HB</option>
              <option value="SB">SB</option>
              <option value="HJ">HJ</option>
              <option value="SJ">SJ</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Number</span>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. HB1456"
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Stage</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="enrolled">Enrolled</option>
              <option value="introduced">Introduced</option>
              <option value="engrossed">Engrossed</option>
              <option value="chaptered">Chaptered</option>
            </select>
          </label>
        </fieldset>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!file || uploading}
          className="rounded bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Analyze"}
        </button>
      </form>
    </div>
  );
}
