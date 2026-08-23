const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentVersionId: string }> },
) {
  const { documentVersionId } = await params;

  const upstream = await fetch(
    `${BACKEND}/api/v1/documents/${documentVersionId}/source`,
  );

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bytes = await upstream.arrayBuffer();
  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  const cd = upstream.headers.get("Content-Disposition");
  if (cd) headers.set("Content-Disposition", cd);
  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(bytes, { status: 200, headers });
}
