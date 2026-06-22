"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import { isPermissionKey } from "@/lib/rbac";

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}${sub}`);
}

/* ------------------------------- members -------------------------------- */

const memberSchema = z.object({
  fullName: z.string().min(2, "نام را وارد کنید."),
  email: z.string().email("ایمیل نامعتبر است."),
  password: z.string().min(6, "رمز عبور حداقل ۶ کاراکتر باشد."),
  title: z.string().optional(),
});

export interface ActionState {
  error?: string;
  ok?: boolean;
}

export async function createMemberAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");

  const parsed = memberSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    title: formData.get("title") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Enforce the company's user quota.
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM platform.user_accounts
    WHERE company_id = ${ctx.company.id}
  `;
  const [{ max_users }] = await sql<{ max_users: number }[]>`
    SELECT max_users FROM platform.companies WHERE id = ${ctx.company.id}
  `;
  if (count >= max_users) {
    return { error: "به سقف تعداد کاربران مجاز شرکت رسیده‌اید." };
  }

  const [existing] = await sql`
    SELECT id FROM platform.user_accounts WHERE email = ${parsed.data.email}
  `;
  if (existing) return { error: "این ایمیل قبلاً ثبت شده است." };

  const passwordHash = await hashPassword(parsed.data.password);
  const [account] = await sql<{ id: string }[]>`
    INSERT INTO platform.user_accounts (email, password_hash, full_name, company_id)
    VALUES (${parsed.data.email}, ${passwordHash}, ${parsed.data.fullName}, ${ctx.company.id})
    RETURNING id
  `;

  await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ id: string }[]>`
      INSERT INTO members (account_id, full_name, title)
      VALUES (${account.id}, ${parsed.data.fullName}, ${parsed.data.title ?? null})
      RETURNING id
    `;
    await tx`INSERT INTO kartabls (member_id, name) VALUES (${m.id}, 'کارتابل اصلی')`;
  });

  rev(slug, "/members");
  return { ok: true };
}

export async function toggleMemberRoleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");
  const memberId = String(formData.get("memberId"));
  const roleId = String(formData.get("roleId"));
  const checked = formData.get("checked") === "1";

  await withTenant(ctx.company.schema, async (tx) => {
    if (checked) {
      await tx`
        INSERT INTO member_roles (member_id, role_id) VALUES (${memberId}, ${roleId})
        ON CONFLICT DO NOTHING
      `;
    } else {
      await tx`
        DELETE FROM member_roles WHERE member_id = ${memberId} AND role_id = ${roleId}
      `;
    }
  });
  rev(slug, "/members");
}

export async function toggleMemberGroupAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");
  const memberId = String(formData.get("memberId"));
  const groupId = String(formData.get("groupId"));
  const checked = formData.get("checked") === "1";

  await withTenant(ctx.company.schema, async (tx) => {
    if (checked) {
      await tx`
        INSERT INTO member_groups (member_id, group_id) VALUES (${memberId}, ${groupId})
        ON CONFLICT DO NOTHING
      `;
    } else {
      await tx`
        DELETE FROM member_groups WHERE member_id = ${memberId} AND group_id = ${groupId}
      `;
    }
  });
  rev(slug, "/members");
}

/* -------------------------------- roles --------------------------------- */

export async function createRoleAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "roles.manage");

  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "نام نقش را وارد کنید." };
  const description = String(formData.get("description") || "");
  const perms = formData.getAll("permissions").map(String).filter(isPermissionKey);

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        INSERT INTO roles (name, description) VALUES (${name}, ${description})
        RETURNING id
      `;
      for (const p of perms) {
        await tx`INSERT INTO role_permissions (role_id, permission_key) VALUES (${r.id}, ${p})`;
      }
    });
  } catch {
    return { error: "نقشی با این نام وجود دارد." };
  }
  rev(slug, "/roles");
  return { ok: true };
}

export async function updateRolePermissionsAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "roles.manage");
  const roleId = String(formData.get("roleId"));
  const perms = formData.getAll("permissions").map(String).filter(isPermissionKey);

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM role_permissions WHERE role_id = ${roleId}`;
    for (const p of perms) {
      await tx`INSERT INTO role_permissions (role_id, permission_key) VALUES (${roleId}, ${p})`;
    }
  });
  rev(slug, "/roles");
}

export async function deleteRoleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "roles.manage");
  const roleId = String(formData.get("roleId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM roles WHERE id = ${roleId} AND is_system = false`;
  });
  rev(slug, "/roles");
}

/* -------------------------------- groups -------------------------------- */

export async function createGroupAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 1) return { error: "نام زیرگروه را وارد کنید." };
  const parentId = formData.get("parentId") ? String(formData.get("parentId")) : null;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`INSERT INTO groups (name, parent_id) VALUES (${name}, ${parentId})`;
  });
  rev(slug, "/groups");
  return { ok: true };
}

export async function deleteGroupAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const groupId = String(formData.get("groupId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM groups WHERE id = ${groupId}`;
  });
  rev(slug, "/groups");
}

/* ------------------------------- kartabl --------------------------------- */

export async function addKartablItemAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const kartablId = String(formData.get("kartablId"));
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "");
  const kind = String(formData.get("kind") || "task");
  if (title.length < 1) return { error: "عنوان را وارد کنید." };

  await withTenant(ctx.company.schema, async (tx) => {
    // ensure the kartabl belongs to the current member unless they can manage all
    const [k] = await tx<{ member_id: string }[]>`
      SELECT member_id FROM kartabls WHERE id = ${kartablId}
    `;
    if (!k) throw new Error("کارتابل یافت نشد.");
    if (k.member_id !== ctx.member.memberId && !ctx.member.permissions.has("kartabl.manage")) {
      throw new Error("دسترسی غیرمجاز.");
    }
    await tx`
      INSERT INTO kartabl_items (kartabl_id, title, body, kind)
      VALUES (${kartablId}, ${title}, ${body}, ${kind})
    `;
  });
  rev(slug, "/kartabl");
  return { ok: true };
}

export async function setKartablItemStatusAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const itemId = String(formData.get("itemId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "done", "archived"].includes(status)) return;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE kartabl_items SET status = ${status} WHERE id = ${itemId}`;
  });
  rev(slug, "/kartabl");
}

export async function createKartablAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "kartabl.manage");
  const memberId = String(formData.get("memberId"));
  const name = String(formData.get("name") || "کارتابل");
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`INSERT INTO kartabls (member_id, name) VALUES (${memberId}, ${name})`;
  });
  rev(slug, "/members");
}
