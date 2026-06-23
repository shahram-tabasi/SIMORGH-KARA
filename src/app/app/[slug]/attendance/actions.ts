"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { isoDate, toGregorian } from "@/lib/jalali";

function rev(slug: string) {
  revalidatePath(`/app/${slug}/attendance`);
  revalidatePath(`/app/${slug}/attendance/team`);
}

/**
 * Toggle punch for the current member: records an "in" or "out" at now(),
 * choosing the kind from today's most recent punch (supports multiple
 * in/out pairs per day, e.g. a lunch break).
 */
export async function punchAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const todayIso = isoDate(new Date());
  await withTenant(ctx.company.schema, async (tx) => {
    const [last] = await tx<{ kind: string }[]>`
      SELECT kind FROM attendance_punches
      WHERE member_id = ${ctx.member.memberId}
        AND punched_at >= ${todayIso}::date
      ORDER BY punched_at DESC LIMIT 1
    `;
    const next = last?.kind === "in" ? "out" : "in";
    await tx`
      INSERT INTO attendance_punches (member_id, kind, source)
      VALUES (${ctx.member.memberId}, ${next}, 'self')
    `;
  });
  rev(slug);
}

/** Manager correction: add a single punch for a member at a Jalali day + time. */
export async function addPunchAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");

  const memberId = String(formData.get("memberId"));
  const jy = Number(formData.get("jy"));
  const jm = Number(formData.get("jm"));
  const jd = Number(formData.get("jd"));
  const time = String(formData.get("time") || "").trim();
  const kind = String(formData.get("kind") || "");
  if (!memberId || !jy || !jm || !jd) return;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
  if (kind !== "in" && kind !== "out") return;

  const day = isoDate(toGregorian(jy, jm, jd));
  const ts = `${day} ${time}`;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_punches (member_id, punched_at, kind, source)
      VALUES (${memberId}, ${ts}, ${kind}, 'manual')
    `;
  });
  revalidatePath(`/app/${slug}/attendance/team`);
}

/** Manager correction: delete a single punch. */
export async function deletePunchAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM attendance_punches WHERE id = ${id}`;
  });
  revalidatePath(`/app/${slug}/attendance/team`);
}

/** Save company attendance rules (grace, daily minutes, leave quotas, overtime). */
export async function savePolicyAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");

  const grace = Math.max(0, Math.min(240, Number(formData.get("grace_minutes")) || 0));
  const daily = Math.max(60, Math.min(1440, Number(formData.get("standard_daily_minutes")) || 480));
  const monthly = Math.max(0, Number(formData.get("monthly_leave_days")) || 0);
  const annual = Math.max(0, Number(formData.get("annual_leave_days")) || 0);
  const overtime = formData.get("overtime_enabled") === "on";

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_policy
        (id, grace_minutes, standard_daily_minutes, monthly_leave_days,
         annual_leave_days, overtime_enabled)
      VALUES (1, ${grace}, ${daily}, ${monthly}, ${annual}, ${overtime})
      ON CONFLICT (id) DO UPDATE SET
        grace_minutes = ${grace},
        standard_daily_minutes = ${daily},
        monthly_leave_days = ${monthly},
        annual_leave_days = ${annual},
        overtime_enabled = ${overtime}
    `;
  });
  revalidatePath(`/app/${slug}/attendance/rules`);
  revalidatePath(`/app/${slug}/attendance`);
}
