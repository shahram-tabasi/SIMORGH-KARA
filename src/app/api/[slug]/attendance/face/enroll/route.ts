import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { resolveTenantSchema, deviceToken } from "@/lib/device-auth";
import { parseEmbedding, normalize } from "@/lib/face";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Enroll a face embedding for a member (computed on-device). Authenticated by
 * a device token. Multiple samples per member improve accuracy.
 *
 *   POST /api/<slug>/attendance/face/enroll
 *   Authorization: Bearer <device-token>
 *   { "email": "ali@co.ir" | "member_id": "<uuid>", "embedding": [ ...floats ] }
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
  const normalized = normalize(vec);

  return withTenant(schema, async (tx) => {
    const [device] = await tx<{ id: string }[]>`
      SELECT id FROM attendance_devices WHERE token = ${token} AND is_active = true
    `;
    if (!device) return NextResponse.json({ error: "invalid device token" }, { status: 401 });
    await tx`UPDATE attendance_devices SET last_seen = now() WHERE id = ${device.id}`;

    let memberId: string | null = null;
    if (typeof body.member_id === "string") {
      const [m] = await tx<{ id: string }[]>`SELECT id FROM members WHERE id = ${body.member_id}`;
      memberId = m?.id ?? null;
    } else if (typeof body.email === "string") {
      const [m] = await tx<{ id: string }[]>`
        SELECT mem.id FROM members mem
        JOIN platform.user_accounts u ON u.id = mem.account_id
        WHERE u.email = ${body.email} LIMIT 1
      `;
      memberId = m?.id ?? null;
    }
    if (!memberId) return NextResponse.json({ error: "member not found" }, { status: 404 });

    await tx`
      INSERT INTO face_embeddings (member_id, vec, dim)
      VALUES (${memberId}, ${tx.json(normalized)}, ${normalized.length})
    `;
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM face_embeddings WHERE member_id = ${memberId}
    `;
    return NextResponse.json({ ok: true, member_id: memberId, samples: n });
  });
}
