const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export const maxDuration = 120;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.arrayBuffer();

  const upstream = await fetch(`${BACKEND}/api/v1/documents/upload`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

  const data = await upstream.text();
  return new Response(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
