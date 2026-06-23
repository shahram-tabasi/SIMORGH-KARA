"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { toGregorian, isoDate } from "@/lib/jalali";

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

  const kind = String(formData.get("kind") || "leave");
  if (!["leave", "mission", "hourly"].includes(kind))
    return { error: "نوع درخواست نامعتبر است." };

  const fy = Number(formData.get("fy"));
  const fm = Number(formData.get("fm"));
  const fd = Number(formData.get("fd"));
  const reason = String(formData.get("reason") || "").trim();
  if (!fy || !fm || !fd) return { error: "تاریخ شروع را وارد کنید." };

  const fromIso = isoDate(toGregorian(fy, fm, fd));
  let toIso = fromIso;
  let fromTime: string | null = null;
  let toTime: string | null = null;

  if (kind === "hourly") {
    fromTime = String(formData.get("from_time") || "");
    toTime = String(formData.get("to_time") || "");
    if (!TIME_RE.test(fromTime) || !TIME_RE.test(toTime))
      return { error: "ساعت شروع/پایان مرخصی ساعتی را وارد کنید." };
  } else {
    const ty = Number(formData.get("ty"));
    const tm = Number(formData.get("tm"));
    const td = Number(formData.get("td"));
    if (!ty || !tm || !td) return { error: "تاریخ پایان را وارد کنید." };
    toIso = isoDate(toGregorian(ty, tm, td));
    if (toIso < fromIso) return { error: "تاریخ پایان نباید قبل از شروع باشد." };
  }

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO leave_requests
        (member_id, kind, from_date, to_date, from_time, to_time, reason)
      VALUES
        (${ctx.member.memberId}, ${kind}, ${fromIso}, ${toIso},
         ${fromTime}, ${toTime}, ${reason})
    `;
  });
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
