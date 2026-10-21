"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { KaraApiError, karaApi } from "@/lib/kara-api";
import { ensurePermission, requireTenant } from "@/lib/session";

export interface ErpFormState {
  error?: string;
  ok?: string;
  /** A fresh key per form: a double submit creates one record, not two. */
  key?: string;
}

const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? undefined : v;
};

/** A partner or product, created in Odoo (the tenant's company) through kara-api. */
export async function createErpRecordAction(prev: ErpFormState, formData: FormData): Promise<ErpFormState> {
  const slug = String(formData.get("slug"));
  const kind = String(formData.get("kind"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "erp.manage");
  if (kind !== "partners" && kind !== "products") return { error: "نوع نامعتبر است." };

  const body =
    kind === "partners"
      ? {
          name: text(formData, "name"),
          email: text(formData, "email"),
          phone: text(formData, "phone"),
          vat: text(formData, "vat"),
          city: text(formData, "city"),
          countryCode: text(formData, "countryCode"),
        }
      : {
          name: text(formData, "name"),
          code: text(formData, "code"),
          type: text(formData, "type") ?? "goods",
          listPrice: text(formData, "listPrice") ? Number(text(formData, "listPrice")) : undefined,
        };
  if (!body.name) return { error: "نام را وارد کنید.", key: prev.key };

  const key = String(formData.get("key") || randomUUID());
  try {
    await karaApi(ctx.session.sub, "POST", `/v1/tenants/${slug}/erp/${kind}`, { body, idempotencyKey: key });
  } catch (e) {
    const msg = e instanceof KaraApiError ? e.message : "ثبت انجام نشد.";
    return { error: msg, key };
  }
  revalidatePath(`/app/${slug}/erp`);
  return { ok: kind === "partners" ? "طرف‌حساب در Odoo ثبت شد." : "کالا در Odoo ثبت شد.", key: randomUUID() };
}
