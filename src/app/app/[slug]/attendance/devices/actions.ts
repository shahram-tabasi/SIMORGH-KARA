"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";

export interface DeviceState {
  error?: string;
  ok?: boolean;
  token?: string;
}

function rev(slug: string) {
  revalidatePath(`/app/${slug}/attendance/devices`);
}

/** Register a new time-clock device / app and mint its API token (HR only). */
export async function createDeviceAction(
  _prev: DeviceState,
  formData: FormData
): Promise<DeviceState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");

  const name = String(formData.get("name") || "").trim();
  const kind = String(formData.get("kind") || "terminal");
  if (name.length < 2) return { error: "نام دستگاه را وارد کنید." };
  if (!["terminal", "guard", "mobile"].includes(kind))
    return { error: "نوع دستگاه نامعتبر است." };

  const token = randomBytes(24).toString("hex");
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO attendance_devices (name, token, kind)
      VALUES (${name}, ${token}, ${kind})
    `;
  });
  rev(slug);
  return { ok: true, token };
}

export async function setDeviceActiveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");
  const id = String(formData.get("id"));
  const active = formData.get("active") === "1";
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE attendance_devices SET is_active = ${active} WHERE id = ${id}`;
  });
  rev(slug);
}

export async function deleteDeviceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");
  const id = String(formData.get("id"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM attendance_devices WHERE id = ${id}`;
  });
  rev(slug);
}
