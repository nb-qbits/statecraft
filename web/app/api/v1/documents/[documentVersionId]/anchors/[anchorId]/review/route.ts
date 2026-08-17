const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentVersionId: string; anchorId: string }> },
) {
  const { documentVersionId, anchorId } = await params;
  const body = await request.text();

  const upstream = await fetch(
    `${BACKEND}/api/v1/documents/${documentVersionId}/anchors/${anchorId}/review`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("idempotency-key")
          ? { "Idempotency-Key": request.headers.get("idempotency-key")! }
          : {}),
      },
      body,
    },
  );

  const data = await upstream.text();
  return new Response(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
