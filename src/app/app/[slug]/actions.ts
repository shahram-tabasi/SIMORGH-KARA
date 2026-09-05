"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql, withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { hashPassword, DEFAULT_PASSWORD } from "@/lib/password";
import { isPermissionKey, PERMISSION_MODULE } from "@/lib/rbac";
import { hasModule } from "@/lib/modules";
import { toGregorian } from "@/lib/jalali";

/** Build a reminder Date from Jalali y/m/d + "HH:MM", or null if incomplete. */
function reminderDate(fd: FormData): Date | null {
  const y = Number(fd.get("ry"));
  const m = Number(fd.get("rm"));
  const d = Number(fd.get("rd"));
  const time = String(fd.get("rtime") || "").trim();
  if (!y || !m || !d) return null;
  const g = toGregorian(y, m, d);
  const [hh, mm] = time && /^\d{1,2}:\d{2}$/.test(time) ? time.split(":").map(Number) : [9, 0];
  return new Date(g.getFullYear(), g.getMonth(), g.getDate(), hh, mm, 0);
}

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}${sub}`);
}

/* ------------------------------- members -------------------------------- */

const memberSchema = z.object({
  fullName: z.string().min(2, "نام را وارد کنید."),
  email: z.string().email("ایمیل نامعتبر است."),
  // Empty means «رمز پیش‌فرض ۱۲۳۴۵۶» — the manager need not invent one.
  password: z.string().default(DEFAULT_PASSWORD),
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
    password: String(formData.get("password") || "").trim() || undefined,
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
    await tx`INSERT INTO member_employment (member_id) VALUES (${m.id})`;
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

  // Guard 1: you can never change your OWN roles. This prevents an admin from
  // accidentally stripping their own access (the "CEO unticks مدیر سامانه" trap).
  // Another admin must change someone's roles.
  if (memberId === ctx.member.memberId) return;

  await withTenant(ctx.company.schema, async (tx) => {
    if (checked) {
      await tx`
        INSERT INTO member_roles (member_id, role_id) VALUES (${memberId}, ${roleId})
        ON CONFLICT DO NOTHING
      `;
    } else {
      // Guard 2: never remove the last member holding a full-access (system
      // admin) role — that would lock the whole company out of management.
      const [role] = await tx<{ is_system: boolean; name: string }[]>`
        SELECT is_system, name FROM roles WHERE id = ${roleId}
      `;
      if (role?.is_system && role.name === "مدیر سامانه") {
        const [{ holders }] = await tx<{ holders: number }[]>`
          SELECT count(*)::int AS holders FROM member_roles WHERE role_id = ${roleId}
        `;
        if (holders <= 1) return; // keep at least one full admin
      }
      await tx`
        DELETE FROM member_roles WHERE member_id = ${memberId} AND role_id = ${roleId}
      `;
    }
  });
  rev(slug, "/members");
}

/** Assign (or clear) a member's work schedule. Empty = use company default. */
export async function setMemberScheduleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");
  const memberId = String(formData.get("memberId"));
  const scheduleId = String(formData.get("scheduleId") || "");

  await withTenant(ctx.company.schema, async (tx) => {
    if (scheduleId) {
      // Guard against a foreign schedule id from another tenant/stale form.
      const [s] = await tx<{ id: string }[]>`
        SELECT id FROM work_schedules WHERE id = ${scheduleId}
      `;
      if (!s) return;
      await tx`UPDATE members SET schedule_id = ${scheduleId} WHERE id = ${memberId}`;
    } else {
      await tx`UPDATE members SET schedule_id = NULL WHERE id = ${memberId}`;
    }
  });
  rev(slug, "/members");
}

/**
 * Assign (or clear) a *group's* work schedule. Every member of the group
 * inherits these hours unless they have a personal schedule of their own.
 */
export async function setGroupScheduleAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const groupId = String(formData.get("groupId"));
  const scheduleId = String(formData.get("scheduleId") || "");

  await withTenant(ctx.company.schema, async (tx) => {
    if (scheduleId) {
      const [s] = await tx<{ id: string }[]>`
        SELECT id FROM work_schedules WHERE id = ${scheduleId}
      `;
      if (!s) return;
      await tx`UPDATE groups SET schedule_id = ${scheduleId} WHERE id = ${groupId}`;
    } else {
      await tx`UPDATE groups SET schedule_id = NULL WHERE id = ${groupId}`;
    }
  });
  rev(slug, "/groups");
  revalidatePath(`/app/${slug}/attendance`);
}

export interface UsernameState {
  error?: string;
  ok?: string;
}

/** HR/manager sets a member's company-scoped login username (for /c/<slug>). */
export async function setMemberUsernameAction(
  _prev: UsernameState,
  formData: FormData
): Promise<UsernameState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");
  const memberId = String(formData.get("memberId"));
  const username = String(formData.get("username") || "").trim();

  if (username && !/^[a-zA-Z0-9._-]{3,32}$/.test(username))
    return { error: "نام کاربری ۳ تا ۳۲ نویسهٔ انگلیسی، عدد یا . _ - باشد." };

  const accountId = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ account_id: string }[]>`
      SELECT account_id FROM members WHERE id = ${memberId}
    `;
    return m?.account_id ?? null;
  });
  if (!accountId) return { error: "عضو یافت نشد." };

  if (username) {
    const [dup] = await sql<{ id: string }[]>`
      SELECT id FROM platform.user_accounts
      WHERE company_id = ${ctx.company.id} AND username = ${username}
        AND id <> ${accountId}
    `;
    if (dup) return { error: "این نام کاربری قبلاً استفاده شده است." };
  }

  await sql`
    UPDATE platform.user_accounts SET username = ${username || null}
    WHERE id = ${accountId}
  `;
  revalidatePath(`/app/${slug}/members`);
  return { ok: username ? "نام کاربری ذخیره شد." : "نام کاربری حذف شد." };
}

/** Set a member's employment profile (hire date, site, daily working minutes). */
export async function setMemberEmploymentAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");
  const memberId = String(formData.get("memberId"));
  const site = ["hq", "factory", "guard"].includes(String(formData.get("site")))
    ? String(formData.get("site"))
    : "hq";
  const siteMinutes: Record<string, number> = { hq: 510, factory: 440, guard: 510 };
  const minutesRaw = Number(formData.get("daily_work_minutes"));
  const minutes =
    Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : siteMinutes[site];

  const jy = Number(formData.get("jy"));
  const jm = Number(formData.get("jm"));
  const jd = Number(formData.get("jd"));
  if (!jy || !jm || !jd) return;
  const { toGregorian, isoDate } = await import("@/lib/jalali");
  const hireIso = isoDate(toGregorian(jy, jm, jd));

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO member_employment (member_id, hire_date, site, daily_work_minutes, updated_at)
      VALUES (${memberId}, ${hireIso}, ${site}, ${minutes}, now())
      ON CONFLICT (member_id) DO UPDATE SET
        hire_date = ${hireIso}, site = ${site},
        daily_work_minutes = ${minutes}, updated_at = now()
    `;
  });
  rev(slug, "/members");
  rev(slug, "/leave");
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

/** Add a member to a group (managed inline from the groups page). */
export async function addGroupMemberAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const groupId = String(formData.get("groupId"));
  const memberId = String(formData.get("memberId"));
  if (!memberId) return;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO member_groups (member_id, group_id) VALUES (${memberId}, ${groupId})
      ON CONFLICT DO NOTHING
    `;
  });
  rev(slug, "/groups");
  rev(slug, "/members");
}

/** Remove a member from a group; if they were the manager, clear that too. */
export async function removeGroupMemberAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const groupId = String(formData.get("groupId"));
  const memberId = String(formData.get("memberId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      DELETE FROM member_groups WHERE member_id = ${memberId} AND group_id = ${groupId}
    `;
    await tx`
      UPDATE groups SET manager_id = NULL
      WHERE id = ${groupId} AND manager_id = ${memberId}
    `;
  });
  rev(slug, "/groups");
  rev(slug, "/members");
}

/** Set (or clear) a group's manager. The manager is also made a member. */
export async function setGroupManagerAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "groups.manage");
  const groupId = String(formData.get("groupId"));
  const memberId = String(formData.get("memberId") || "");
  await withTenant(ctx.company.schema, async (tx) => {
    if (memberId) {
      // Guard against a stale/foreign member id.
      const [m] = await tx<{ id: string }[]>`SELECT id FROM members WHERE id = ${memberId}`;
      if (!m) return;
      await tx`
        INSERT INTO member_groups (member_id, group_id) VALUES (${memberId}, ${groupId})
        ON CONFLICT DO NOTHING
      `;
      await tx`UPDATE groups SET manager_id = ${memberId} WHERE id = ${groupId}`;
    } else {
      await tx`UPDATE groups SET manager_id = NULL WHERE id = ${groupId}`;
    }
  });
  rev(slug, "/groups");
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
  const perms = formData
    .getAll("permissions")
    .map(String)
    .filter(isPermissionKey)
    .filter((k) => hasModule(ctx.company.modules, PERMISSION_MODULE[k]));

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
    // Keys of panels this company does not have are not shown in the form —
    // keep them untouched so a role does not silently lose them while a panel
    // is switched off.
    const existing = await tx<{ permission_key: string }[]>`
      SELECT permission_key FROM role_permissions WHERE role_id = ${roleId}
    `;
    const hidden = existing
      .map((e) => e.permission_key)
      .filter(
        (k) =>
          isPermissionKey(k) && !hasModule(ctx.company.modules, PERMISSION_MODULE[k])
      );

    await tx`DELETE FROM role_permissions WHERE role_id = ${roleId}`;
    for (const p of [...new Set([...perms, ...hidden])]) {
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
/*
 * Accountability model:
 *  - The *owner* of a kartabl is the person it belongs to (the assignee).
 *  - `created_by` records who created/assigned each item (the assigner).
 *  - Editing/deleting an item is allowed ONLY for the assigner, or for a
 *    kartabl manager acting on SOMEONE ELSE's kartabl. A person can never
 *    edit or delete a task that was assigned to them — even the CEO. They may
 *    only report progress (status).
 */

interface ItemCtx {
  owner_id: string;
  created_by: string | null;
}

function canEditItem(item: ItemCtx, memberId: string, perms: Set<string>) {
  if (item.created_by === memberId) return true; // the assigner / self-author
  if (item.owner_id === memberId) return false; // never edit your own assigned task
  return perms.has("kartabl.manage"); // managing another member's kartabl
}

function canSetStatus(item: ItemCtx, memberId: string, perms: Set<string>) {
  return (
    item.owner_id === memberId ||
    item.created_by === memberId ||
    perms.has("kartabl.manage")
  );
}

/** Add a note/task to one's OWN kartabl (self-authored, freely editable). */
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
  const remindAt = reminderDate(formData);

  await withTenant(ctx.company.schema, async (tx) => {
    const [k] = await tx<{ member_id: string }[]>`
      SELECT member_id FROM kartabls WHERE id = ${kartablId}
    `;
    if (!k) throw new Error("کارتابل یافت نشد.");
    if (
      k.member_id !== ctx.member.memberId &&
      !ctx.member.permissions.has("kartabl.manage")
    ) {
      throw new Error("دسترسی غیرمجاز.");
    }
    await tx`
      INSERT INTO kartabl_items (kartabl_id, title, body, kind, created_by, remind_at)
      VALUES (${kartablId}, ${title}, ${body}, ${kind}, ${ctx.member.memberId}, ${remindAt})
    `;
  });
  rev(slug, "/kartabl");
  return { ok: true };
}

/** Assign a task INTO another member's kartabl (requires kartabl.assign). */
export async function assignTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "kartabl.assign");

  const targetMemberId = String(formData.get("memberId"));
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "");
  const kind = String(formData.get("kind") || "task");
  if (!targetMemberId) return { error: "عضو مقصد را انتخاب کنید." };
  if (title.length < 1) return { error: "عنوان کار را وارد کنید." };

  try {
    await withTenant(ctx.company.schema, async (tx) => {
      let [k] = await tx<{ id: string }[]>`
        SELECT id FROM kartabls WHERE member_id = ${targetMemberId}
        ORDER BY created_at LIMIT 1
      `;
      if (!k) {
        [k] = await tx<{ id: string }[]>`
          INSERT INTO kartabls (member_id, name)
          VALUES (${targetMemberId}, 'کارتابل اصلی') RETURNING id
        `;
      }
      await tx`
        INSERT INTO kartabl_items (kartabl_id, title, body, kind, created_by)
        VALUES (${k.id}, ${title}, ${body}, ${kind}, ${ctx.member.memberId})
      `;
    });
  } catch {
    return { error: "خطا در ارجاع کار." };
  }
  rev(slug, "/kartabl");
  return { ok: true };
}

export async function editKartablItemAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const itemId = String(formData.get("itemId"));
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "");
  if (title.length < 1) return { error: "عنوان را وارد کنید." };

  const result = await withTenant(ctx.company.schema, async (tx) => {
    const [item] = await tx<ItemCtx[]>`
      SELECT k.member_id AS owner_id, i.created_by
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE i.id = ${itemId}
    `;
    if (!item) return "notfound";
    if (!canEditItem(item, ctx.member.memberId, ctx.member.permissions)) {
      return "forbidden";
    }
    await tx`
      UPDATE kartabl_items SET title = ${title}, body = ${body} WHERE id = ${itemId}
    `;
    return "ok";
  });

  if (result === "forbidden")
    return { error: "این کار توسط فرد دیگری به شما ارجاع شده و قابل ویرایش نیست." };
  if (result === "notfound") return { error: "مورد یافت نشد." };
  rev(slug, "/kartabl");
  return { ok: true };
}

export async function deleteKartablItemAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const itemId = String(formData.get("itemId"));
  await withTenant(ctx.company.schema, async (tx) => {
    const [item] = await tx<ItemCtx[]>`
      SELECT k.member_id AS owner_id, i.created_by
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE i.id = ${itemId}
    `;
    if (!item) return;
    if (!canEditItem(item, ctx.member.memberId, ctx.member.permissions)) {
      throw new Error("اجازهٔ حذف این کار را ندارید.");
    }
    await tx`DELETE FROM kartabl_items WHERE id = ${itemId}`;
  });
  rev(slug, "/kartabl");
}

export async function setKartablItemStatusAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const itemId = String(formData.get("itemId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "done", "archived"].includes(status)) return;
  await withTenant(ctx.company.schema, async (tx) => {
    const [item] = await tx<ItemCtx[]>`
      SELECT k.member_id AS owner_id, i.created_by
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE i.id = ${itemId}
    `;
    if (!item) return;
    if (!canSetStatus(item, ctx.member.memberId, ctx.member.permissions)) {
      throw new Error("اجازهٔ تغییر وضعیت را ندارید.");
    }
    await tx`UPDATE kartabl_items SET status = ${status} WHERE id = ${itemId}`;
  });
  rev(slug, "/kartabl");
}

/**
 * Cycle a kartabl item's status (باز → در حال انجام → انجام‌شده). Called by
 * double-clicking the item on the unified calendar. Only the owner (or a
 * kartabl manager) may change it.
 */
export async function cycleKartablStatusAction(slug: string, itemId: string) {
  const ctx = await requireTenant(slug);
  const order = ["open", "in_progress", "done"];
  await withTenant(ctx.company.schema, async (tx) => {
    const [item] = await tx<{ owner_id: string; created_by: string | null; status: string }[]>`
      SELECT k.member_id AS owner_id, i.created_by, i.status
      FROM kartabl_items i JOIN kartabls k ON k.id = i.kartabl_id
      WHERE i.id = ${itemId}
    `;
    if (!item) return;
    if (!canSetStatus(item, ctx.member.memberId, ctx.member.permissions)) return;
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    await tx`UPDATE kartabl_items SET status = ${next} WHERE id = ${itemId}`;
  });
  rev(slug, "/kartabl");
  rev(slug, "/calendar");
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


/* ------------------- دسترسی جز‌به‌جز هر عضو (overrides) ------------------- */

/**
 * Grant or deny a single permission to one person, on top of their roles.
 *
 * effect = "grant"   → این مجوز را فقط به همین نفر بده (بدون دادن کل نقش)
 * effect = "deny"    → این مجوز را از همین نفر بگیر، حتی اگر نقشش آن را دارد
 * effect = "inherit" → استثنا حذف شود و همان چیزی که نقش می‌گوید اعمال شود
 */
export async function setMemberPermissionAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.permissions.manage");

  const memberId = String(formData.get("memberId"));
  const key = String(formData.get("permissionKey"));
  const effect = String(formData.get("effect"));

  if (!isPermissionKey(key)) return;
  // A key of a panel the company does not have must never be handed out.
  if (!hasModule(ctx.company.modules, PERMISSION_MODULE[key])) return;
  // Same guard as roles: nobody edits their own access level.
  if (memberId === ctx.member.memberId) return;

  await withTenant(ctx.company.schema, async (tx) => {
    if (effect === "inherit") {
      await tx`
        DELETE FROM member_permissions
        WHERE member_id = ${memberId} AND permission_key = ${key}
      `;
      return;
    }
    if (effect !== "grant" && effect !== "deny") return;
    await tx`
      INSERT INTO member_permissions (member_id, permission_key, effect, granted_by)
      VALUES (${memberId}, ${key}, ${effect}, ${ctx.member.memberId})
      ON CONFLICT (member_id, permission_key)
      DO UPDATE SET effect = ${effect}, granted_by = ${ctx.member.memberId}
    `;
  });

  rev(slug, `/members/${memberId}/access`);
  rev(slug, "/members");
}

/** Drop every per-person exception, returning the member to their roles. */
export async function clearMemberPermissionsAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.permissions.manage");
  const memberId = String(formData.get("memberId"));
  if (memberId === ctx.member.memberId) return;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM member_permissions WHERE member_id = ${memberId}`;
  });
  rev(slug, `/members/${memberId}/access`);
  rev(slug, "/members");
}

/* ---------------- ایمیل ورود و بازنشانی رمز عبور اعضا ---------------- */

export interface MemberAccountState {
  error?: string;
  ok?: string;
  /** Set only after a reset — shown to the manager once. */
  password?: string;
}

/**
 * Resolve a member's platform account, asserting it really belongs to this
 * company and is not a platform admin. Everything below goes through this, so
 * a crafted memberId can never reach another tenant's account.
 */
async function memberAccountId(
  ctx: Awaited<ReturnType<typeof requireTenant>>,
  memberId: string
): Promise<string | null> {
  const accountId = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ account_id: string }[]>`
      SELECT account_id FROM members WHERE id = ${memberId}
    `;
    return m?.account_id ?? null;
  });
  if (!accountId) return null;

  const [account] = await sql<{ id: string }[]>`
    SELECT id FROM platform.user_accounts
    WHERE id = ${accountId} AND company_id = ${ctx.company.id}
      AND NOT is_platform_admin
  `;
  return account?.id ?? null;
}

/** Manager corrects a member's login e-mail (the address they sign in with). */
export async function setMemberEmailAction(
  _prev: MemberAccountState,
  formData: FormData
): Promise<MemberAccountState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");

  const memberId = String(formData.get("memberId"));
  const email = String(formData.get("email") || "").trim();

  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { error: "ایمیل نامعتبر است." };

  const accountId = await memberAccountId(ctx, memberId);
  if (!accountId) return { error: "این حساب قابل ویرایش نیست." };

  const [dup] = await sql<{ id: string }[]>`
    SELECT id FROM platform.user_accounts
    WHERE email = ${email} AND id <> ${accountId}
  `;
  if (dup) return { error: "این ایمیل قبلاً ثبت شده است." };

  try {
    await sql`
      UPDATE platform.user_accounts SET email = ${email} WHERE id = ${accountId}
    `;
  } catch {
    return { error: "ثبت ایمیل ممکن نشد؛ احتمالاً تکراری است." };
  }

  rev(slug, "/members");
  return { ok: "ایمیل ذخیره شد." };
}

/**
 * Manager resets a member's password: either one they type, or a generated one
 * when the field is empty. Returned once so it can be handed over; only the
 * bcrypt hash is stored. Nobody resets their own password here — that goes
 * through «پروفایل من», which asks for the current password first.
 */
export async function resetMemberPasswordAction(
  _prev: MemberAccountState,
  formData: FormData
): Promise<MemberAccountState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "members.manage");

  const memberId = String(formData.get("memberId"));
  if (memberId === ctx.member.memberId) {
    return { error: "رمز خودتان را از «پروفایل من» تغییر دهید." };
  }

  const accountId = await memberAccountId(ctx, memberId);
  if (!accountId) return { error: "این حساب قابل بازنشانی نیست." };

  const typed = String(formData.get("newPassword") || "").trim();
  if (typed && typed.length < 8) {
    return { error: "رمز جدید حداقل ۸ نویسه باشد." };
  }
  const password = typed || DEFAULT_PASSWORD;

  await sql`
    UPDATE platform.user_accounts
    SET password_hash = ${await hashPassword(password)}
    WHERE id = ${accountId}
  `;

  rev(slug, "/members");
  return { ok: "رمز عبور بازنشانی شد.", password };
}
