"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";
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
