import { karaApiEnabled, karaApiStream } from "@/lib/kara-api";
import { tenantSession } from "@/lib/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The signed-in person's live events (incoming calls…), streamed from kara-api. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const s = await tenantSession(params.slug);
  if (!s) return new Response("unauthorized", { status: 401 });
  if (!karaApiEnabled()) return new Response("off", { status: 503 });
  const upstream = await karaApiStream(s.sub, "/v1/me/live", req.signal).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) return new Response("unavailable", { status: 503 });
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
