import { NextRequest } from "next/server";
import { requireTenant, ensurePermission } from "@/lib/session";
import { todayJalali, JALALI_MONTHS } from "@/lib/jalali";
import { loadMonthSummaries } from "../../data";

function dur(min: number): string {
  if (!min || min <= 0) return "0:00";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const sp = req.nextUrl.searchParams;
  const today = todayJalali();
  const jy = Number(sp.get("y")) || today.jy;
  const jm = Number(sp.get("m")) || today.jm;

  const rows = await loadMonthSummaries(ctx.company.schema, jy, jm);

  const header = [
    "عضو",
    "روزهای حاضر",
    "غایب",
    "مرخصی/مأموریت",
    "مجموع کارکرد",
    "مجموع تأخیر",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        `"${r.name.replace(/"/g, '""')}"`,
        r.presentDays,
        r.absentDays,
        r.leaveDays,
        dur(r.workedMinutes),
        dur(r.lateMinutes),
      ].join(",")
    );
  }

  // BOM so Excel reads UTF-8 (Persian) correctly.
  const csv = "﻿" + lines.join("\r\n");
  const fname = `attendance-${jy}-${String(jm).padStart(2, "0")}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
