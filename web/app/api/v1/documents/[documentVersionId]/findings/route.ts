const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentVersionId: string }> },
) {
  const { documentVersionId } = await params;

  const upstream = await fetch(
    `${BACKEND}/api/v1/documents/${documentVersionId}/findings`,
  );

  const data = await upstream.text();
  return new Response(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
