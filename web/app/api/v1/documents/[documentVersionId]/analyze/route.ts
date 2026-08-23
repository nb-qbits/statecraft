const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentVersionId: string }> },
) {
  const { documentVersionId } = await params;
  const qs = new URL(request.url).search;

  const upstream = await fetch(
    `${BACKEND}/api/v1/documents/${documentVersionId}/analyze${qs}`,
    { method: "POST" },
  );

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          const text = decoder.decode(value, { stream: true });
          if (text.includes('"complete"') || text.includes('"failed"')) {
            break;
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ stage: "error", status: "failed", counts: {}, error: "Stream interrupted" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
        reader.cancel().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
