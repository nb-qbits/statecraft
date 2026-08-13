export interface LegalIdentity {
  jurisdiction: string;
  session: string;
  instrumentType: string;
  number: string;
  stage: string;
  chapter: string | null;
}

export interface UploadResult {
  documentVersionId: string;
  documentId: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
}

export interface StageEvent {
  stage: string;
  status: string;
  counts: Record<string, number>;
  error?: string;
}

export interface Finding {
  anchorId: string;
  segmentId: string;
  structuralPath: string;
  provisionLabel: string;
  quotedText: string;
  kind: string;
  anchored: boolean;
  anchorMethod: string | null;
  anchorFailureReason: string | null;
  grammarParsed: boolean;
  grammarFailureReason: string | null;
  resolved: boolean;
  statutoryDate: string | null;
  adjustedDate: string | null;
  ruleIds: string[];
  citations: string[];
  packVersion: string | null;
  unresolvedReason: string | null;
  missingInputs: string[] | null;
  lane: string;
  laneReasons: string[];
  supportLevel: string;
  deterministicChecks: Record<string, unknown> | null;
}

export interface RejectedSpan {
  quotedText: string;
  reason: string;
}

export interface SuppressedSpan {
  quotedText: string;
  segmentId: string;
  reason: string;
  containedBy: string | null;
}

export interface FindingsResponse {
  findings: Finding[];
  coverage: {
    totalSegments: number;
    withCandidates: number;
    screenedNoCandidate: number;
    needsSweep: number;
  };
  laneSummary: Record<string, number>;
  rejectedSpans: RejectedSpan[];
  suppressedSpans: SuppressedSpan[];
}

export async function uploadDocument(
  file: File,
  identity: LegalIdentity,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("legalIdentity", JSON.stringify(identity));

  const res = await fetch("/api/v1/documents/upload", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function* streamAnalysis(
  dvId: string,
): AsyncGenerator<StageEvent> {
  const res = await fetch(`/api/v1/documents/${dvId}/analyze`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analysis failed (${res.status}): ${text}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      if (part.startsWith("data: ")) {
        yield JSON.parse(part.slice(6));
      }
    }
  }

  if (buffer.startsWith("data: ")) {
    yield JSON.parse(buffer.slice(6));
  }
}

export async function fetchFindings(
  dvId: string,
): Promise<FindingsResponse> {
  const res = await fetch(`/api/v1/documents/${dvId}/findings`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Findings fetch failed (${res.status}): ${text}`);
  }
  return res.json();
}
