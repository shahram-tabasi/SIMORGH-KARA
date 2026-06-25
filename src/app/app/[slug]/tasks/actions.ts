"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";
import { toGregorian, isoDate } from "@/lib/jalali";

export interface TaskState {
  error?: string;
  ok?: boolean;
}

function rev(slug: string) {
  revalidatePath(`/app/${slug}/tasks`);
  revalidatePath(`/app/${slug}/tasks/calendar`);
  revalidatePath(`/app/${slug}`);
}

function jdate(fd: FormData, p: string): string | null {
  const y = Number(fd.get(`${p}y`));
  const m = Number(fd.get(`${p}m`));
  const d = Number(fd.get(`${p}d`));
  if (!y || !m || !d) return null;
  return isoDate(toGregorian(y, m, d));
}

/** Create and assign a task — to a whole subgroup or to chosen individuals. */
export async function createTaskAction(
  _prev: TaskState,
  formData: FormData
): Promise<TaskState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  // Only managers/sub-group leads may assign tasks to others.
  if (!ctx.member.permissions.has("tasks.assign"))
    return { error: "شما اجازهٔ ارسال وظیفه ندارید؛ تنها می‌توانید وظیفه را واگذار کنید." };

  const title = String(formData.get("title") || "").trim();
  if (title.length < 2) return { error: "عنوان کار را وارد کنید." };
  const code = String(formData.get("code") || "").trim() || null;
  const body = String(formData.get("body") || "").trim() || null;
  const priority = ["normal", "urgent", "forced"].includes(String(formData.get("priority")))
    ? String(formData.get("priority"))
    : "normal";
  const mode = String(formData.get("mode") || "members");
  const fromDate = jdate(formData, "f");
  const dueDate = jdate(formData, "t");
  const parentId = formData.get("parentId") ? String(formData.get("parentId")) : null;

  const result = await withTenant(ctx.company.schema, async (tx) => {
    let memberIds: string[] = [];
    let groupId: string | null = null;

    if (mode === "group") {
      groupId = String(formData.get("groupId") || "");
      if (!groupId) return { error: "زیرگروه را انتخاب کنید." };
      const rows = await tx<{ member_id: string }[]>`
        SELECT member_id FROM member_groups WHERE group_id = ${groupId}
      `;
      memberIds = rows.map((r) => r.member_id);
      if (memberIds.length === 0)
        return { error: "این زیرگروه عضوی ندارد." };
    } else {
      memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
      if (memberIds.length === 0)
        return { error: "حداقل یک نفر را انتخاب کنید." };
    }

    const [task] = await tx<{ id: string }[]>`
      INSERT INTO work_tasks
        (title, body, code, priority, from_date, due_date, created_by, group_id, parent_id)
      VALUES (${title}, ${body}, ${code}, ${priority}, ${fromDate}, ${dueDate},
              ${ctx.member.memberId}, ${groupId}, ${parentId})
      RETURNING id
    `;
    for (const mid of memberIds) {
      await tx`
        INSERT INTO work_task_assignees (task_id, member_id)
        VALUES (${task.id}, ${mid}) ON CONFLICT DO NOTHING
      `;
    }
    return { ok: true as const };
  });

  if ("error" in result) return result;
  rev(slug);
  return { ok: true };
}

/** Assignee confirms receipt (تأیید دریافت) — a read receipt the sender sees. */
export async function acknowledgeTaskAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const taskId = String(formData.get("taskId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE work_task_assignees
      SET acknowledged_at = now(), updated_at = now()
      WHERE task_id = ${taskId} AND member_id = ${ctx.member.memberId}
        AND acknowledged_at IS NULL
    `;
  });
  rev(slug);
}

/**
 * Send a plain message (پیام صرف) — not a task — to a whole sub-group or to
 * chosen individuals. It lands in each recipient's kartabl as a 'message' item.
 */
export async function sendMessageAction(
  _prev: TaskState,
  formData: FormData
): Promise<TaskState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  if (!ctx.member.permissions.has("tasks.assign"))
    return { error: "شما اجازهٔ ارسال پیام گروهی ندارید." };

  const title = String(formData.get("title") || "").trim();
  if (title.length < 2) return { error: "متن پیام را وارد کنید." };
  const body = String(formData.get("body") || "").trim() || null;
  const mode = String(formData.get("mode") || "members");

  const result = await withTenant(ctx.company.schema, async (tx) => {
    let memberIds: string[] = [];
    if (mode === "group") {
      const groupId = String(formData.get("groupId") || "");
      if (!groupId) return { error: "زیرگروه را انتخاب کنید." };
      const rows = await tx<{ member_id: string }[]>`
        SELECT member_id FROM member_groups WHERE group_id = ${groupId}
      `;
      memberIds = rows.map((r) => r.member_id);
      if (memberIds.length === 0) return { error: "این زیرگروه عضوی ندارد." };
    } else {
      memberIds = formData.getAll("memberIds").map(String).filter(Boolean);
      if (memberIds.length === 0) return { error: "حداقل یک نفر را انتخاب کنید." };
    }

    for (const mid of memberIds) {
      const [k] = await tx<{ id: string }[]>`
        SELECT id FROM kartabls WHERE member_id = ${mid} ORDER BY created_at LIMIT 1
      `;
      if (!k) continue;
      await tx`
        INSERT INTO kartabl_items (kartabl_id, title, body, kind, created_by)
        VALUES (${k.id}, ${title}, ${body}, 'message', ${ctx.member.memberId})
      `;
    }
    return { ok: true as const };
  });

  if ("error" in result) return result;
  revalidatePath(`/app/${slug}/kartabl`);
  rev(slug);
  return { ok: true };
}

/** Assignee updates the progress status of their own task. */
export async function setTaskStatusAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const taskId = String(formData.get("taskId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "done"].includes(status)) return;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE work_task_assignees SET status = ${status}, updated_at = now()
      WHERE task_id = ${taskId} AND member_id = ${ctx.member.memberId}
    `;
  });
  rev(slug);
}

/**
 * Transfer (واگذاری) a received task to a colleague. Any assignee may do this —
 * it is the only way a regular sub-group member can move work — without needing
 * the assign permission. The assignment moves to the target and remembers who
 * delegated it.
 */
export async function delegateTaskAction(
  _prev: TaskState,
  formData: FormData
): Promise<TaskState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const me = ctx.member.memberId;
  const taskId = String(formData.get("taskId"));
  const toId = String(formData.get("toMemberId") || "");
  if (!toId) return { error: "گیرنده را انتخاب کنید." };
  if (toId === me) return { error: "نمی‌توانید کار را به خودتان واگذار کنید." };

  const result = await withTenant(ctx.company.schema, async (tx) => {
    const [mine] = await tx<{ id: string }[]>`
      SELECT id FROM work_task_assignees
      WHERE task_id = ${taskId} AND member_id = ${me}
    `;
    if (!mine) return { error: "این کار به شما ارجاع نشده است." };

    const [exists] = await tx<{ id: string }[]>`
      SELECT id FROM work_task_assignees
      WHERE task_id = ${taskId} AND member_id = ${toId}
    `;
    if (exists) {
      // Target already has it — just drop mine.
      await tx`DELETE FROM work_task_assignees WHERE id = ${mine.id}`;
    } else {
      await tx`
        UPDATE work_task_assignees
        SET member_id = ${toId}, delegated_from = ${me},
            status = 'open', updated_at = now()
        WHERE id = ${mine.id}
      `;
    }
    return { ok: true as const };
  });

  if ("error" in result) return result;
  rev(slug);
  return { ok: true };
}

/** The creator deletes a task they assigned. */
export async function deleteTaskAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const taskId = String(formData.get("taskId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      DELETE FROM work_tasks
      WHERE id = ${taskId} AND created_by = ${ctx.member.memberId}
    `;
  });
  rev(slug);
}
