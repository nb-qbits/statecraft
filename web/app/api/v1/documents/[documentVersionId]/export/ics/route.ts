const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentVersionId: string }> },
) {
  const { documentVersionId } = await params;

  const upstream = await fetch(
    `${BACKEND}/api/v1/documents/${documentVersionId}/export/ics`,
  );

  const data = await upstream.arrayBuffer();
  return new Response(data, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/calendar",
      "Content-Disposition":
        upstream.headers.get("Content-Disposition") ?? "attachment",
    },
  });
}
