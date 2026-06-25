import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { resolveTenantSchema, deviceToken, sourceForKind } from "@/lib/device-auth";
import { parseEmbedding, normalize, bestMatch, FACE_MATCH_THRESHOLD } from "@/lib/face";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Identify a member from a probe embedding (on-device) via cosine matching,
 * and optionally record the punch automatically.
 *
 *   POST /api/<slug>/attendance/face/identify
 *   Authorization: Bearer <device-token>
 *   { "embedding": [ ...floats ],
 *     "kind": "in"|"out"?, "auto_punch": true?, "photo_url": "..."?,
 *     "lat": 35.7?, "lng": 51.4? }
 */
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const schema = await resolveTenantSchema(params.slug);
  if (!schema) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

  const token = deviceToken(req);
  if (!token) return NextResponse.json({ error: "missing device token" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const vec = parseEmbedding(body.embedding);
  if (!vec) return NextResponse.json({ error: "invalid embedding" }, { status: 400 });
  const probe = normalize(vec);

  return withTenant(schema, async (tx) => {
    const [device] = await tx<{ id: string; kind: string }[]>`
      SELECT id, kind FROM attendance_devices WHERE token = ${token} AND is_active = true
    `;
    if (!device) return NextResponse.json({ error: "invalid device token" }, { status: 401 });
    await tx`UPDATE attendance_devices SET last_seen = now() WHERE id = ${device.id}`;

    const rows = await tx<{ member_id: string; vec: string }[]>`
      SELECT member_id, vec::text AS vec FROM face_embeddings
    `;
    const samples: { member_id: string; vec: number[] }[] = [];
    for (const r of rows) {
      try {
        const v = JSON.parse(r.vec);
        if (Array.isArray(v) && v.length === probe.length) samples.push({ member_id: r.member_id, vec: v });
      } catch {
        /* skip malformed */
      }
    }
    const match = bestMatch(probe, samples);

    if (!match || match.score < FACE_MATCH_THRESHOLD) {
      return NextResponse.json({ matched: false, score: match?.score ?? 0 });
    }

    const [member] = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE id = ${match.memberId}
    `;

    let punchId: string | null = null;
    const kind = String(body.kind || "");
    if (body.auto_punch === true && (kind === "in" || kind === "out")) {
      const source = sourceForKind(device.kind);
      const photo = typeof body.photo_url === "string" ? body.photo_url : null;
      const lat = typeof body.lat === "number" ? body.lat : null;
      const lng = typeof body.lng === "number" ? body.lng : null;
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO attendance_punches (member_id, kind, source, photo_url, lat, lng)
        VALUES (${match.memberId}, ${kind}, ${source}, ${photo}, ${lat}, ${lng})
        RETURNING id
      `;
      punchId = row.id;
    }

    return NextResponse.json({
      matched: true,
      member: { id: member.id, name: member.full_name },
      score: Number(match.score.toFixed(4)),
      punch_id: punchId,
    });
  });
}
