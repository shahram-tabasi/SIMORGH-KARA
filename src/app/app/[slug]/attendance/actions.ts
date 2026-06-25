"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { isoDate, toGregorian, iranianWeekday } from "@/lib/jalali";

function rev(slug: string) {
  revalidatePath(`/app/${slug}/attendance`);
  revalidatePath(`/app/${slug}/attendance/team`);
}

/** Iranian-week start (Saturday) ISO for a YYYY-MM-DD string. */
function weekStartIso(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const wd = iranianWeekday(date); // 0=Sat..6=Fri
  date.setDate(date.getDate() - wd);
  return isoDate(date);
}

export interface PunchResult {
  ok?: boolean;
  error?: string;
  added?: number;
  skipped?: number;
}

/**
 * Register manual ورود/خروج for the current member on one or more selected
 * days at a chosen time. Honours the HR-set caps on manual punches per
 * week/month (0 = unlimited); over-cap days are skipped and reported.
 */
export async function registerPunchesAction(
  slug: string,
  isos: string[],
  kind: "in" | "out",
  time: string
): Promise<PunchResult> {
  const ctx = await requireTenant(slug);
  if (kind !== "in" && kind !== "out") return { error: "نوع تردد نامعتبر است." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "ساعت نامعتبر است." };
  const days = [...new Set(isos.map((s) => s.slice(0, 10)))].sort();
  if (days.length === 0) return { error: "روزی انتخاب نشده است." };

  return withTenant(ctx.company.schema, async (tx) => {
    const [policy] = await tx<{ max_punches_per_week: number; max_punches_per_month: number }[]>`
      SELECT max_punches_per_week, max_punches_per_month FROM attendance_policy WHERE id = 1
    `;
    const maxWeek = policy?.max_punches_per_week ?? 0;
    const maxMonth = policy?.max_punches_per_month ?? 0;

    const existing = await tx<{ d: string }[]>`
      SELECT punched_at::date::text AS d FROM attendance_punches
      WHERE member_id = ${ctx.member.memberId} AND source IN ('self','manual')
    `;
    const monthN = new Map<string, number>();
    const weekN = new Map<string, number>();
    for (const r of existing) {
      const mk = r.d.slice(0, 7);
      const wk = weekStartIso(r.d);
      monthN.set(mk, (monthN.get(mk) ?? 0) + 1);
      weekN.set(wk, (weekN.get(wk) ?? 0) + 1);
    }

    let added = 0;
    let skipped = 0;
    for (const iso of days) {
      const mk = iso.slice(0, 7);
      const wk = weekStartIso(iso);
      if (
        (maxMonth > 0 && (monthN.get(mk) ?? 0) >= maxMonth) ||
        (maxWeek > 0 && (weekN.get(wk) ?? 0) >= maxWeek)
      ) {
        skipped++;
        continue;
      }
      await tx`
        INSERT INTO attendance_punches (member_id, punched_at, kind, source)
        VALUES (${ctx.member.memberId}, ${`${iso} ${time}`}, ${kind}, 'self')
      `;
      monthN.set(mk, (monthN.get(mk) ?? 0) + 1);
      weekN.set(wk, (weekN.get(wk) ?? 0) + 1);
      added++;
    }
    rev(slug);
    if (added === 0)
      return { error: "سقف ثبت تردد دستی پر شده است؛ با کارگزینی هماهنگ کنید.", added, skipped };
    return { ok: true, added, skipped };
  });
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
  const maxWeek = Math.max(0, Math.min(99, Number(formData.get("max_punches_per_week")) || 0));
  const maxMonth = Math.max(0, Math.min(999, Number(formData.get("max_punches_per_month")) || 0));

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_policy
        (id, grace_minutes, standard_daily_minutes, monthly_leave_days,
         annual_leave_days, overtime_enabled, max_punches_per_week, max_punches_per_month)
      VALUES (1, ${grace}, ${daily}, ${monthly}, ${annual}, ${overtime}, ${maxWeek}, ${maxMonth})
      ON CONFLICT (id) DO UPDATE SET
        grace_minutes = ${grace},
        standard_daily_minutes = ${daily},
        monthly_leave_days = ${monthly},
        annual_leave_days = ${annual},
        overtime_enabled = ${overtime},
        max_punches_per_week = ${maxWeek},
        max_punches_per_month = ${maxMonth}
    `;
  });
  revalidatePath(`/app/${slug}/attendance/rules`);
  revalidatePath(`/app/${slug}/attendance`);
}
