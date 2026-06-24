import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { toJalali, toFaDigits, JALALI_MONTHS, todayJalali } from "@/lib/jalali";
import { TaskForm } from "./TaskForm";
import { DelegateControl } from "./DelegateControl";
import { setTaskStatusAction, deleteTaskAction } from "./actions";

const PRIORITY = {
  normal: { label: "عادی", badge: "bg-slate-100 text-slate-500", row: "" },
  urgent: { label: "ضروری", badge: "bg-amber-100 text-amber-700", row: "border-r-4 border-r-amber-400" },
  forced: { label: "فوری/اجباری", badge: "bg-red-100 text-red-700", row: "border-r-4 border-r-red-500 bg-red-50/40" },
} as const;
const STATUS: Record<string, string> = { open: "باز", in_progress: "در حال انجام", done: "انجام‌شده" };
const STATUS_TONE: Record<string, string> = {
  open: "bg-slate-100 text-slate-500",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

function faDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const j = toJalali(new Date(y, m - 1, d));
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
}

interface MyTask {
  task_id: string;
  title: string;
  body: string | null;
  code: string | null;
  priority: keyof typeof PRIORITY;
  due_date: string | null;
  status: string;
  assigner: string | null;
  delegated_from: string | null;
}
interface SentTask {
  id: string;
  title: string;
  code: string | null;
  priority: keyof typeof PRIORITY;
  due_date: string | null;
  group_name: string | null;
  total: number;
  done: number;
}
interface SentAssignee {
  task_id: string;
  name: string;
  status: string;
}

export default async function TasksPage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  const me = ctx.member.memberId;
  const canAssign = ctx.member.permissions.has("tasks.assign");

  const data = await withTenant(ctx.company.schema, async (tx) => {
    const groups = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM groups ORDER BY name`;
    const members = await tx<{ id: string; name: string }[]>`
      SELECT id, full_name AS name FROM members WHERE status='active' AND id <> ${me} ORDER BY full_name`;
    const myTasks = await tx<MyTask[]>`
      SELECT a.task_id, t.title, t.body, t.code, t.priority, t.due_date::text,
             a.status, m.full_name AS assigner, df.full_name AS delegated_from
      FROM work_task_assignees a
      JOIN work_tasks t ON t.id = a.task_id
      LEFT JOIN members m ON m.id = t.created_by
      LEFT JOIN members df ON df.id = a.delegated_from
      WHERE a.member_id = ${me}
      ORDER BY (t.priority='forced') DESC, (t.priority='urgent') DESC, t.created_at DESC`;
    const sent = await tx<SentTask[]>`
      SELECT t.id, t.title, t.code, t.priority, t.due_date::text, g.name AS group_name,
             count(a.*)::int AS total,
             count(a.*) FILTER (WHERE a.status='done')::int AS done
      FROM work_tasks t
      LEFT JOIN work_task_assignees a ON a.task_id = t.id
      LEFT JOIN groups g ON g.id = t.group_id
      WHERE t.created_by = ${me}
      GROUP BY t.id, g.name
      ORDER BY t.created_at DESC`;
    const sentAssignees = await tx<SentAssignee[]>`
      SELECT a.task_id, m.full_name AS name, a.status
      FROM work_task_assignees a JOIN members m ON m.id = a.member_id
      JOIN work_tasks t ON t.id = a.task_id
      WHERE t.created_by = ${me} ORDER BY m.full_name`;
    return { groups, members, myTasks, sent, sentAssignees };
  });

  const assigneesByTask = new Map<string, SentAssignee[]>();
  for (const a of data.sentAssignees) {
    const l = assigneesByTask.get(a.task_id);
    if (l) l.push(a);
    else assigneesByTask.set(a.task_id, [a]);
  }

  return (
    <>
      <PageHeader
        title="میز کار"
        description={
          canAssign
            ? "ارسال کار به افراد یا زیرگروه‌ها، پیگیری وضعیت و گزارش کارهای ارسالی"
            : "کارهای ارجاع‌شده به شما — می‌توانید وضعیت را به‌روز یا کار را به هم‌گروه واگذار کنید"
        }
      />

      {canAssign && (
        <div className="mb-6">
          <TaskForm slug={params.slug} year={todayJalali().jy} groups={data.groups} members={data.members} />
        </div>
      )}

      <div className={canAssign ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : ""}>
        {/* کارهای من */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            کارهای من ({toFaDigits(data.myTasks.length)})
          </h3>
          {data.myTasks.length === 0 ? (
            <div className="card text-sm text-slate-400">کاری به شما ارجاع نشده است.</div>
          ) : (
            <div className="space-y-2">
              {data.myTasks.map((t) => {
                const p = PRIORITY[t.priority] ?? PRIORITY.normal;
                return (
                  <div key={t.task_id} className={`card ${p.row}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-800">{t.title}</span>
                          {t.code && <span className="badge bg-slate-100 text-slate-500" dir="ltr">{t.code}</span>}
                          {t.priority !== "normal" && <span className={`badge ${p.badge}`}>{p.label}</span>}
                        </div>
                        {t.body && <div className="mt-1 text-xs text-slate-500">{t.body}</div>}
                        <div className="mt-1 text-[11px] text-slate-400">
                          از طرف: {t.assigner ?? "—"} · سررسید: {faDate(t.due_date)}
                          {t.delegated_from && (
                            <span className="mr-1 text-sky-600">· واگذارشده از {t.delegated_from}</span>
                          )}
                        </div>
                        <div className="mt-2">
                          <DelegateControl
                            slug={params.slug}
                            taskId={t.task_id}
                            colleagues={data.members}
                          />
                        </div>
                      </div>
                      <form action={setTaskStatusAction} className="shrink-0">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="taskId" value={t.task_id} />
                        <select name="status" defaultValue={t.status} className="input w-32 text-xs">
                          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button className="mt-1 w-full text-xs text-brand-600 hover:underline">ثبت وضعیت</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* کارهای ارسالی من (گزارش) — فقط برای ارسال‌کنندگان */}
        {canAssign && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            گزارش کارهای ارسالی من ({toFaDigits(data.sent.length)})
          </h3>
          {data.sent.length === 0 ? (
            <div className="card text-sm text-slate-400">کاری ارسال نکرده‌اید.</div>
          ) : (
            <div className="space-y-2">
              {data.sent.map((t) => {
                const p = PRIORITY[t.priority] ?? PRIORITY.normal;
                const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
                return (
                  <div key={t.id} className={`card ${p.row}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-800">{t.title}</span>
                          {t.code && <span className="badge bg-slate-100 text-slate-500" dir="ltr">{t.code}</span>}
                          {t.priority !== "normal" && <span className={`badge ${p.badge}`}>{p.label}</span>}
                          {t.group_name && <span className="badge bg-indigo-50 text-indigo-700">گروهی: {t.group_name}</span>}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          سررسید: {faDate(t.due_date)} · {toFaDigits(t.done)} از {toFaDigits(t.total)} انجام‌شده
                        </div>
                        <div className="mt-1 h-1.5 w-40 overflow-hidden rounded bg-slate-100">
                          <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(assigneesByTask.get(t.id) ?? []).map((a, i) => (
                            <span key={i} className={`badge ${STATUS_TONE[a.status]}`}>
                              {a.name}: {STATUS[a.status]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <form action={deleteTaskAction} className="shrink-0">
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="taskId" value={t.id} />
                        <button className="text-xs text-red-600 hover:underline">حذف</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </>
  );
}
