"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { isoDate, toGregorian } from "@/lib/jalali";

function rev(slug: string) {
  revalidatePath(`/app/${slug}/attendance`);
  revalidatePath(`/app/${slug}/attendance/team`);
}

/** Punch IN for the current member (today). */
export async function punchInAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const today = isoDate(new Date());
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_days (member_id, work_date, check_in)
      VALUES (${ctx.member.memberId}, ${today}, now())
      ON CONFLICT (member_id, work_date)
      DO UPDATE SET check_in = COALESCE(attendance_days.check_in, now())
    `;
  });
  rev(slug);
}

/** Punch OUT for the current member (today). */
export async function punchOutAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const today = isoDate(new Date());
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_days (member_id, work_date, check_in, check_out)
      VALUES (${ctx.member.memberId}, ${today}, now(), now())
      ON CONFLICT (member_id, work_date)
      DO UPDATE SET check_out = now(),
                   check_in = COALESCE(attendance_days.check_in, now())
    `;
  });
  rev(slug);
}

/**
 * Manager correction: set/clear a member's punch times for a given Jalali day.
 * Times are "HH:MM" (local). Empty clears the punch.
 */
export async function saveAttendanceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");

  const memberId = String(formData.get("memberId"));
  const jy = Number(formData.get("jy"));
  const jm = Number(formData.get("jm"));
  const jd = Number(formData.get("jd"));
  const inT = String(formData.get("check_in") || "").trim();
  const outT = String(formData.get("check_out") || "").trim();
  if (!memberId || !jy || !jm || !jd) return;

  const day = isoDate(toGregorian(jy, jm, jd)); // YYYY-MM-DD (local)
  const inTs = /^\d{1,2}:\d{2}$/.test(inT) ? `${day} ${inT}` : null;
  const outTs = /^\d{1,2}:\d{2}$/.test(outT) ? `${day} ${outT}` : null;

  await withTenant(ctx.company.schema, async (tx) => {
    if (!inTs && !outTs) {
      await tx`
        DELETE FROM attendance_days
        WHERE member_id = ${memberId} AND work_date = ${day}
      `;
      return;
    }
    await tx`
      INSERT INTO attendance_days (member_id, work_date, check_in, check_out)
      VALUES (${memberId}, ${day}, ${inTs}, ${outTs})
      ON CONFLICT (member_id, work_date)
      DO UPDATE SET check_in = ${inTs}, check_out = ${outTs}
    `;
  });
  revalidatePath(`/app/${slug}/attendance/team`);
}
