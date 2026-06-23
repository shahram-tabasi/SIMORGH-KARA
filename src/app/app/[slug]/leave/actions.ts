"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import {
  toGregorian,
  isoDate,
  toJalali,
  jalaliMonthLength,
  iranianWeekday,
} from "@/lib/jalali";
import {
  computeEffectiveDays,
  holidaysInRange,
  proratedAccrual,
} from "@/lib/leave-balance";
import { timeToMinutes } from "@/lib/attendance";
import { stepPerm } from "./shared";

function parseIso(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

/** Max allowed negative entitlement balance (مرخصی منفی), in days. */
const MAX_NEGATIVE_DAYS = 3;

/* ---- kartabl routing: drop the request into the current approvers' inboxes -- */

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Create an approval item in the kartabl of every member holding `perm`. */
async function notifyApprovers(
  tx: Tx,
  requestId: string,
  perm: string,
  requesterId: string,
  requesterName: string,
  summary: string
) {
  const approvers = await tx<{ member_id: string }[]>`
    SELECT DISTINCT mr.member_id
    FROM member_roles mr JOIN role_permissions rp ON rp.role_id = mr.role_id
    WHERE rp.permission_key = ${perm} AND mr.member_id <> ${requesterId}
  `;
  for (const a of approvers) {
    let [k] = await tx<{ id: string }[]>`
      SELECT id FROM kartabls WHERE member_id = ${a.member_id}
      ORDER BY created_at LIMIT 1
    `;
    if (!k) {
      [k] = await tx<{ id: string }[]>`
        INSERT INTO kartabls (member_id, name)
        VALUES (${a.member_id}, 'کارتابل اصلی') RETURNING id
      `;
    }
    await tx`
      INSERT INTO kartabl_items
        (kartabl_id, title, body, kind, ref_kind, ref_id, created_by)
      VALUES (${k.id}, ${`درخواست مرخصی: ${requesterName}`}, ${summary},
              'approval', 'leave_request', ${requestId}, ${requesterId})
    `;
  }
}

/** Remove all pending approval items that point at this request. */
async function clearApprovalItems(tx: Tx, requestId: string) {
  await tx`
    DELETE FROM kartabl_items
    WHERE kind = 'approval' AND ref_kind = 'leave_request' AND ref_id = ${requestId}
  `;
}

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
        deducts_entitlement: boolean;
        max_minutes_per_day: number | null;
        max_count_per_month: number | null;
        max_count_per_week: number | null;
        max_days_per_year: string | null;
        approval_levels: number;
        is_active: boolean;
      }[]
    >`
      SELECT code, unit, requires_attachment, counts_inner_holidays,
             deducts_entitlement, max_minutes_per_day, max_count_per_month,
             max_count_per_week, max_days_per_year, approval_levels, is_active
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
    const [emp] = await tx<{ daily_work_minutes: number; hire_date: string }[]>`
      SELECT daily_work_minutes, hire_date::text FROM member_employment
      WHERE member_id = ${ctx.member.memberId}
    `;
    const dailyMinutes = emp?.daily_work_minutes ?? 510;
    const holidays = await holidaysInRange(tx, fromIso, toIso);
    const effectiveDays = computeEffectiveDays({
      unit: type.unit,
      countsInnerHolidays: type.counts_inner_holidays,
      fromIso,
      toIso,
      fromTime,
      toTime,
      holidays,
      dailyMinutes,
    });

    const member = ctx.member.memberId;
    const jFrom = toJalali(parseIso(fromIso));

    // (a) Hourly per-day ceiling (e.g. ۴ ساعت؛ بیش از آن باید روزانه ثبت شود).
    if (type.unit === "hour" && type.max_minutes_per_day != null) {
      const mins = timeToMinutes(toTime!) - timeToMinutes(fromTime!);
      if (mins > type.max_minutes_per_day) {
        const h = Math.floor(type.max_minutes_per_day / 60);
        return {
          error: `بیش از سقف مجاز روزانه (${h} ساعت) است؛ این روز را باید به‌صورت مرخصی روزانه ثبت کنید.`,
        };
      }
    }

    // (b) Monthly occurrence cap (e.g. ۵ نوبت ساعتی در ماه).
    if (type.max_count_per_month != null) {
      const mStart = isoDate(toGregorian(jFrom.jy, jFrom.jm, 1));
      const mEnd = isoDate(
        toGregorian(jFrom.jy, jFrom.jm, jalaliMonthLength(jFrom.jy, jFrom.jm))
      );
      const [{ c }] = await tx<{ c: number }[]>`
        SELECT count(*)::int AS c FROM leave_requests
        WHERE member_id = ${member} AND type_id = ${typeId}
          AND status <> 'rejected' AND from_date BETWEEN ${mStart} AND ${mEnd}
      `;
      if (c >= type.max_count_per_month)
        return { error: `به سقف ${type.max_count_per_month} نوبت در ماه برای این نوع مرخصی رسیده‌اید.` };
    }

    // (c) Weekly occurrence cap (e.g. مجوز خروج ۲ بار در هفته).
    if (type.max_count_per_week != null) {
      const wd = iranianWeekday(parseIso(fromIso)); // 0=Sat
      const ws = parseIso(fromIso);
      const weekStart = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() - wd);
      const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
      const [{ c }] = await tx<{ c: number }[]>`
        SELECT count(*)::int AS c FROM leave_requests
        WHERE member_id = ${member} AND type_id = ${typeId}
          AND status <> 'rejected'
          AND from_date BETWEEN ${isoDate(weekStart)} AND ${isoDate(weekEnd)}
      `;
      if (c >= type.max_count_per_week)
        return { error: `به سقف ${type.max_count_per_week} نوبت در هفته برای این نوع مرخصی رسیده‌اید.` };
    }

    // (d) Annual day cap for this type.
    if (type.max_days_per_year != null) {
      const yStart = isoDate(toGregorian(jFrom.jy, 1, 1));
      const yEnd = isoDate(toGregorian(jFrom.jy, 12, jalaliMonthLength(jFrom.jy, 12)));
      const [{ s }] = await tx<{ s: string }[]>`
        SELECT COALESCE(sum(effective_days),0) AS s FROM leave_requests
        WHERE member_id = ${member} AND type_id = ${typeId}
          AND status <> 'rejected' AND from_date BETWEEN ${yStart} AND ${yEnd}
      `;
      if (Number(s) + effectiveDays > Number(type.max_days_per_year))
        return { error: `با این درخواست از سقف ${type.max_days_per_year} روز در سال این نوع مرخصی فراتر می‌روید.` };
    }

    // (e) Negative-balance cap for entitlement-deducting leave (مرخصی منفی ۳ روز).
    if (type.deducts_entitlement) {
      const [pol] = await tx<{ annual_leave_days: string }[]>`
        SELECT annual_leave_days FROM attendance_policy WHERE id = 1
      `;
      const annual = Number(pol?.annual_leave_days ?? 30);
      const hire = parseIso(emp?.hire_date ?? fromIso);
      const accrued = proratedAccrual(hire, jFrom.jy, annual);

      const used = await tx<{ from_date: string; effective_days: string | null }[]>`
        SELECT lr.from_date::text, lr.effective_days FROM leave_requests lr
        JOIN leave_types lt ON lt.id = lr.type_id
        WHERE lr.member_id = ${member} AND lr.status = 'approved'
          AND lt.deducts_entitlement = true
      `;
      let usedDays = 0;
      for (const u of used)
        if (toJalali(parseIso(u.from_date)).jy === jFrom.jy)
          usedDays += Number(u.effective_days ?? 0);

      const ledger = await tx<{ days: string }[]>`
        SELECT days FROM leave_ledger
        WHERE member_id = ${member} AND jyear = ${jFrom.jy}
      `;
      const ledgerNet = ledger.reduce((a, l) => a + Number(l.days), 0);

      const remaining = accrued + ledgerNet - usedDays;
      if (remaining - effectiveDays < -MAX_NEGATIVE_DAYS) {
        return {
          error: `مانده استحقاقی کافی نیست (مانده ${remaining.toFixed(1)} روز). حداکثر ${MAX_NEGATIVE_DAYS} روز مرخصی منفی مجاز است؛ از مرخصی بدون حقوق استفاده کنید.`,
        };
      }
    }

    // Map to the legacy `kind` used by the attendance sheet reflection.
    const kind =
      type.code === "mission"
        ? "mission"
        : type.unit === "hour"
          ? "hourly"
          : "leave";

    const totalSteps = Math.max(1, Math.min(3, type.approval_levels || 1));
    const [req] = await tx<{ id: string }[]>`
      INSERT INTO leave_requests
        (member_id, type_id, kind, from_date, to_date, from_time, to_time,
         reason, attachment_url, effective_days, total_steps, current_step)
      VALUES
        (${ctx.member.memberId}, ${typeId}, ${kind}, ${fromIso}, ${toIso},
         ${fromTime}, ${toTime}, ${reason}, ${attachment}, ${effectiveDays},
         ${totalSteps}, 1)
      RETURNING id
    `;
    // Build the approval chain (one row per required level).
    for (let s = 1; s <= totalSteps; s++) {
      await tx`
        INSERT INTO leave_approvals (request_id, step_order, perm_key)
        VALUES (${req.id}, ${s}, ${stepPerm(s)})
      `;
    }
    // Drop the request into the first approver's (مدیر بخش) kartabl.
    await notifyApprovers(
      tx,
      req.id,
      stepPerm(1),
      ctx.member.memberId,
      ctx.member.fullName,
      reason || "درخواست مرخصی جدید"
    );
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
    const [r] = await tx<{ id: string }[]>`
      DELETE FROM leave_requests
      WHERE id = ${id} AND member_id = ${ctx.member.memberId} AND status = 'pending'
      RETURNING id
    `;
    if (r) await clearApprovalItems(tx, id);
  });
  rev(slug);
}

/**
 * Approve or reject at the request's *current* approval step. Approving the
 * final step marks the request approved; any rejection rejects it outright.
 */
export async function decideLeaveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") || "").trim() || null;
  if (!["approved", "rejected"].includes(decision)) return;

  await withTenant(ctx.company.schema, async (tx) => {
    const [req] = await tx<
      { current_step: number; total_steps: number; member_id: string; full_name: string }[]
    >`
      SELECT lr.current_step, lr.total_steps, lr.member_id, m.full_name
      FROM leave_requests lr JOIN members m ON m.id = lr.member_id
      WHERE lr.id = ${id} AND lr.status = 'pending'
    `;
    if (!req) return;

    // Only the holder of the current step's permission may act.
    const requiredPerm = stepPerm(req.current_step);
    if (!ctx.member.permissions.has(requiredPerm)) return;

    await tx`
      UPDATE leave_approvals
      SET status = ${decision}, decided_by = ${ctx.member.memberId},
          decided_at = now(), note = ${note}
      WHERE request_id = ${id} AND step_order = ${req.current_step}
    `;

    // This approver's kartabl item (and peers') is resolved either way.
    await clearApprovalItems(tx, id);

    if (decision === "rejected") {
      await tx`
        UPDATE leave_requests
        SET status = 'rejected', decided_by = ${ctx.member.memberId}, decided_at = now()
        WHERE id = ${id}
      `;
      return;
    }

    if (req.current_step >= req.total_steps) {
      // Final approval → recorded and deducted from the balance.
      await tx`
        UPDATE leave_requests
        SET status = 'approved', decided_by = ${ctx.member.memberId}, decided_at = now()
        WHERE id = ${id}
      `;
    } else {
      const next = req.current_step + 1;
      await tx`UPDATE leave_requests SET current_step = ${next} WHERE id = ${id}`;
      // Route the request into the next approver's (کارگزینی) kartabl.
      await notifyApprovers(
        tx,
        id,
        stepPerm(next),
        req.member_id,
        req.full_name,
        "در انتظار تأیید مرحله بعد"
      );
    }
  });
  rev(slug);
}
