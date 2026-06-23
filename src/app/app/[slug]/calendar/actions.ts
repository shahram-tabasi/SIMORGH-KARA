"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { toGregorian, isoDate } from "@/lib/jalali";
import { officialHolidaysFor } from "@/lib/iran-holidays";

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}${sub}`);
}

export interface CalState {
  error?: string;
  ok?: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ----------------------------- work schedules --------------------------- */

export async function saveScheduleAction(
  _prev: CalState,
  formData: FormData
): Promise<CalState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");

  const id = formData.get("id") ? String(formData.get("id")) : null;
  const name = String(formData.get("name") || "").trim();
  const start = String(formData.get("start_time") || "");
  const end = String(formData.get("end_time") || "");
  const workDays = formData
    .getAll("work_days")
    .map((d) => Number(d))
    .filter((d) => d >= 0 && d <= 6);

  if (name.length < 2) return { error: "نام شیفت را وارد کنید." };
  if (!TIME_RE.test(start) || !TIME_RE.test(end))
    return { error: "ساعت شروع/پایان نامعتبر است." };
  if (workDays.length === 0) return { error: "حداقل یک روز کاری انتخاب کنید." };

  const arr = `{${workDays.join(",")}}`;
  await withTenant(ctx.company.schema, async (tx) => {
    if (id) {
      await tx`
        UPDATE work_schedules
        SET name = ${name}, work_days = ${arr}, start_time = ${start}, end_time = ${end}
        WHERE id = ${id}
      `;
    } else {
      await tx`
        INSERT INTO work_schedules (name, work_days, start_time, end_time)
        VALUES (${name}, ${arr}, ${start}, ${end})
      `;
    }
  });
  rev(slug, "/calendar/settings");
  rev(slug, "/calendar");
  return { ok: true };
}

export async function setDefaultScheduleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE work_schedules SET is_default = false`;
    await tx`UPDATE work_schedules SET is_default = true WHERE id = ${id}`;
  });
  rev(slug, "/calendar/settings");
  rev(slug, "/calendar");
}

export async function deleteScheduleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    const [s] = await tx<{ is_default: boolean }[]>`
      SELECT is_default FROM work_schedules WHERE id = ${id}
    `;
    if (s?.is_default) return; // keep the default schedule
    await tx`UPDATE members SET schedule_id = NULL WHERE schedule_id = ${id}`;
    await tx`DELETE FROM work_schedules WHERE id = ${id}`;
  });
  rev(slug, "/calendar/settings");
}

/* -------------------------------- holidays ------------------------------ */

export async function addHolidayAction(
  _prev: CalState,
  formData: FormData
): Promise<CalState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");

  const jy = Number(formData.get("jy"));
  const jm = Number(formData.get("jm"));
  const jd = Number(formData.get("jd"));
  const title = String(formData.get("title") || "").trim();
  if (!jy || !jm || !jd) return { error: "تاریخ را کامل وارد کنید." };
  if (title.length < 2) return { error: "عنوان تعطیلی را وارد کنید." };

  const date = isoDate(toGregorian(jy, jm, jd));
  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`
        INSERT INTO holidays (holiday_date, title, is_official)
        VALUES (${date}, ${title}, false)
        ON CONFLICT (holiday_date) DO UPDATE SET title = EXCLUDED.title
      `;
    });
  } catch {
    return { error: "خطا در ثبت تعطیلی." };
  }
  rev(slug, "/calendar/settings");
  rev(slug, "/calendar");
  return { ok: true };
}

/**
 * Bulk-import official Iranian holidays for a Jalali year. Solar holidays are
 * exact; religious (lunar) ones are converted and may need a ±1 day tweak, so
 * they stay editable. Existing dates are left untouched.
 */
export async function importOfficialHolidaysAction(
  _prev: CalState,
  formData: FormData
): Promise<CalState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");

  const jy = Number(formData.get("jy"));
  if (!jy || jy < 1300 || jy > 1500) return { error: "سال نامعتبر است." };

  const holidays = officialHolidaysFor(jy);
  await withTenant(ctx.company.schema, async (tx) => {
    for (const h of holidays) {
      await tx`
        INSERT INTO holidays (holiday_date, title, is_official)
        VALUES (${h.iso}, ${h.title}, true)
        ON CONFLICT (holiday_date) DO NOTHING
      `;
    }
  });
  rev(slug, "/calendar/settings");
  rev(slug, "/calendar");
  return { ok: true };
}

export async function deleteHolidayAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "calendar.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM holidays WHERE id = ${id}`;
  });
  rev(slug, "/calendar/settings");
  rev(slug, "/calendar");
}
