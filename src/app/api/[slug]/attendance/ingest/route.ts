import { NextResponse } from "next/server";
import { sql, withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Punch ingestion endpoint for hardware time-clocks (face/fingerprint
 * terminals), the guard app and the miner mobile app. Authenticated by a
 * device token (created by HR in attendance_devices). The client posts a
 * member reference + in/out + optional time/photo/GPS; we record the punch.
 *
 *   POST /api/<slug>/attendance/ingest
 *   Authorization: Bearer <device-token>
 *   { "member_code": "1023" | "member_id": "<uuid>" | "email": "x@y",
 *     "kind": "in" | "out", "at": "2026-06-25T08:01:00Z"?,
 *     "photo_url": "..."?, "lat": 35.7?, "lng": 51.4? }
 */
export async function POST(
  req: Request,
  { params }: { params: { slug: string } }
) {
  // Resolve tenant schema from the control plane.
  const [company] = await sql<{ schema_name: string; status: string }[]>`
    SELECT schema_name, status FROM platform.companies WHERE slug = ${params.slug}
  `;
  if (!company || company.status === "suspended") {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-device-token") || "";
  if (!token) return NextResponse.json({ error: "missing device token" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const kind = String(body.kind || "");
  if (kind !== "in" && kind !== "out") {
    return NextResponse.json({ error: "kind must be in|out" }, { status: 400 });
  }
  const at = typeof body.at === "string" && body.at ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "invalid at" }, { status: 400 });
  }

  return withTenant(company.schema_name, async (tx) => {
    const [device] = await tx<{ id: string; kind: string }[]>`
      SELECT id, kind FROM attendance_devices WHERE token = ${token} AND is_active = true
    `;
    if (!device) return NextResponse.json({ error: "invalid device token" }, { status: 401 });
    await tx`UPDATE attendance_devices SET last_seen = now() WHERE id = ${device.id}`;

    // Resolve the member by id or e-mail.
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

    const source = device.kind === "guard" ? "guard" : device.kind === "mobile" ? "mobile" : "device";
    const photo = typeof body.photo_url === "string" ? body.photo_url : null;
    const lat = typeof body.lat === "number" ? body.lat : null;
    const lng = typeof body.lng === "number" ? body.lng : null;

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO attendance_punches (member_id, punched_at, kind, source, photo_url, lat, lng)
      VALUES (${memberId}, ${at.toISOString()}, ${kind}, ${source}, ${photo}, ${lat}, ${lng})
      RETURNING id
    `;
    return NextResponse.json({ ok: true, punch_id: row.id, source });
  });
}
