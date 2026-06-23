"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { toGregorian, isoDate } from "@/lib/jalali";
import { computeEffectiveDays, holidaysInRange } from "@/lib/leave-balance";

function rev(slug: string) {
  revalidatePath(`/app/${slug}/leave`);
  revalidatePath(`/app/${slug}/leave/manage`);
  revalidatePath(`/app/${slug}/attendance`);
}

export interface LeaveState {
  error?: string;
  ok?: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Submit a leave / mission / hourly-leave request for the current member. */
export async function submitLeaveAction(
  _prev: LeaveState,
  formData: FormData
): Promise<LeaveState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);

  const typeId = String(formData.get("type_id") || "");
  if (!typeId) return { error: "نوع مرخصی را انتخاب کنید." };

  const fy = Number(formData.get("fy"));
  const fm = Number(formData.get("fm"));
  const fd = Number(formData.get("fd"));
  const reason = String(formData.get("reason") || "").trim();
  const attachment = String(formData.get("attachment_url") || "").trim() || null;
  if (!fy || !fm || !fd) return { error: "تاریخ شروع را وارد کنید." };

  const fromIso = isoDate(toGregorian(fy, fm, fd));
  let toIso = fromIso;
  let fromTime: string | null = null;
  let toTime: string | null = null;

  const result = await withTenant(ctx.company.schema, async (tx) => {
    const [type] = await tx<
      {
        code: string;
        unit: "day" | "hour";
        requires_attachment: boolean;
        counts_inner_holidays: boolean;
        is_active: boolean;
      }[]
    >`
      SELECT code, unit, requires_attachment, counts_inner_holidays, is_active
      FROM leave_types WHERE id = ${typeId}
    `;
    if (!type || !type.is_active) return { error: "نوع مرخصی نامعتبر است." };

    if (type.unit === "hour") {
      fromTime = String(formData.get("from_time") || "");
      toTime = String(formData.get("to_time") || "");
      if (!TIME_RE.test(fromTime) || !TIME_RE.test(toTime))
        return { error: "ساعت شروع و پایان را وارد کنید." };
    } else {
      const ty = Number(formData.get("ty"));
      const tm = Number(formData.get("tm"));
      const td = Number(formData.get("td"));
      if (!ty || !tm || !td) return { error: "تاریخ پایان را وارد کنید." };
      toIso = isoDate(toGregorian(ty, tm, td));
      if (toIso < fromIso) return { error: "تاریخ پایان نباید قبل از شروع باشد." };
    }

    if (type.requires_attachment && !attachment)
      return { error: "برای این نوع مرخصی پیوست مدرک الزامی است." };

    // Compute billable days (skips inner holidays / converts hours → day fraction).
    const [emp] = await tx<{ daily_work_minutes: number }[]>`
      SELECT daily_work_minutes FROM member_employment
      WHERE member_id = ${ctx.member.memberId}
    `;
    const holidays = await holidaysInRange(tx, fromIso, toIso);
    const effectiveDays = computeEffectiveDays({
      unit: type.unit,
      countsInnerHolidays: type.counts_inner_holidays,
      fromIso,
      toIso,
      fromTime,
      toTime,
      holidays,
      dailyMinutes: emp?.daily_work_minutes ?? 510,
    });

    // Map to the legacy `kind` used by the attendance sheet reflection.
    const kind =
      type.code === "mission"
        ? "mission"
        : type.unit === "hour"
          ? "hourly"
          : "leave";

    await tx`
      INSERT INTO leave_requests
        (member_id, type_id, kind, from_date, to_date, from_time, to_time,
         reason, attachment_url, effective_days)
      VALUES
        (${ctx.member.memberId}, ${typeId}, ${kind}, ${fromIso}, ${toIso},
         ${fromTime}, ${toTime}, ${reason}, ${attachment}, ${effectiveDays})
    `;
    return { ok: true as const };
  });

  if ("error" in result) return result;
  rev(slug);
  return { ok: true };
}

/** Member cancels their own still-pending request. */
export async function cancelLeaveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      DELETE FROM leave_requests
      WHERE id = ${id} AND member_id = ${ctx.member.memberId} AND status = 'pending'
    `;
  });
  rev(slug);
}

/** Approver decides on a request. */
export async function decideLeaveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "leave.approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  if (!["approved", "rejected"].includes(decision)) return;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE leave_requests
      SET status = ${decision}, decided_by = ${ctx.member.memberId}, decided_at = now()
      WHERE id = ${id} AND status = 'pending'
    `;
  });
  rev(slug);
}
