"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission, ensureModule } from "@/lib/session";
import { generateApiKey } from "@/lib/api-auth";
import { isPermissionKey, PERMISSION_MODULE } from "@/lib/rbac";
import { hasModule } from "@/lib/modules";

export interface ApiKeyState {
  error?: string;
  ok?: boolean;
  token?: string;
}

/**
 * Mint an API key for an external program. The scopes are ordinary permission
 * keys, filtered to the panels this company has — so a key can never reach
 * further than the company itself does.
 */
export async function createApiKeyAction(
  _prev: ApiKeyState,
  formData: FormData
): Promise<ApiKeyState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "api");
  ensurePermission(ctx, "api.keys.manage");

  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "نام کلید را وارد کنید (مثلاً «سیستم فروش»)." };

  const scopes = formData
    .getAll("scopes")
    .map(String)
    .filter(isPermissionKey)
    .filter((k) => hasModule(ctx.company.modules, PERMISSION_MODULE[k]));
  if (scopes.length === 0) {
    return { error: "حداقل یک دسترسی (scope) برای کلید انتخاب کنید." };
  }

  const days = Number(formData.get("expiresDays") || 0);
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;

  const { token, prefix, hash } = generateApiKey();
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO api_keys (name, prefix, token_hash, scopes, expires_at, created_by)
      VALUES (${name}, ${prefix}, ${hash}, ${scopes}, ${expiresAt}, ${ctx.member.memberId})
    `;
  });

  revalidatePath(`/app/${slug}/integrations`);
  return { ok: true, token };
}

export async function toggleApiKeyAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "api");
  ensurePermission(ctx, "api.keys.manage");
  const id = String(formData.get("keyId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE api_keys SET is_active = NOT is_active WHERE id = ${id}`;
  });
  revalidatePath(`/app/${slug}/integrations`);
}

export async function deleteApiKeyAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "api");
  ensurePermission(ctx, "api.keys.manage");
  const id = String(formData.get("keyId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM api_keys WHERE id = ${id}`;
  });
  revalidatePath(`/app/${slug}/integrations`);
}
