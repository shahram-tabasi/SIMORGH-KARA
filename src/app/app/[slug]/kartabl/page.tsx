import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { KartablItemForm } from "./KartablItemForm";
import { AssignTaskForm } from "./AssignTaskForm";
import { ItemActions } from "./ItemActions";
import { setKartablItemStatusAction } from "../actions";

interface Item {
  id: string;
  kartabl_id: string;
  title: string;
  body: string | null;
  kind: string;
  status: string;
  created_by: string | null;
  assigner: string | null;
  ref_kind: string | null;
  ref_id: string | null;
}

const statusLabel: Record<string, string> = {
  open: "باز",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
  archived: "بایگانی",
};
const statusBadge: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};
const kindLabel: Record<string, string> = {
  task: "وظیفه",
  document: "سند",
  message: "پیام",
  approval: "درخواست تأیید",
};

async function loadData(schema: string, memberId: string, canAssign: boolean) {
  return withTenant(schema, async (tx) => {
    const kartabls = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM kartabls WHERE member_id = ${memberId} ORDER BY created_at
    `;
    const items = await tx<Item[]>`
      SELECT i.id, i.kartabl_id, i.title, i.body, i.kind, i.status,
             i.created_by, i.ref_kind, i.ref_id, cb.full_name AS assigner
      FROM kartabl_items i
      JOIN kartabls k ON k.id = i.kartabl_id
      LEFT JOIN members cb ON cb.id = i.created_by
      WHERE k.member_id = ${memberId}
      ORDER BY i.created_at DESC
    `;
    const members = canAssign
      ? await tx<{ id: string; name: string }[]>`
          SELECT id, full_name AS name FROM members
          WHERE status = 'active' ORDER BY full_name
        `
      : [];
    return { kartabls, items, members };
  });
}

export default async function KartablPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const meId = ctx.member.memberId;
  const canAssign = ctx.member.permissions.has("kartabl.assign");
  const { kartabls, items, members } = await loadData(
    ctx.company.schema,
    meId,
    canAssign
  );

  return (
    <>
      <PageHeader
        title="کارتابل من"
        description="کارها، اسناد و پیام‌های ارجاع‌شده به شما"
      />

      {canAssign && (
        <div className="mb-6">
          <AssignTaskForm slug={params.slug} members={members} />
        </div>
      )}

      {kartabls.map((k) => {
        const myItems = items.filter((i) => i.kartabl_id === k.id);
        return (
          <div key={k.id} className="card mb-6">
            <h3 className="mb-3 font-semibold text-slate-800">{k.name}</h3>

            <div className="mb-2 text-xs text-slate-400">
              یادداشت/کار شخصی (فقط برای خودتان):
            </div>
            <KartablItemForm slug={params.slug} kartablId={k.id} />

            <ul className="mt-4 space-y-2">
              {myItems.length === 0 && (
                <li className="text-sm text-slate-400">موردی ثبت نشده است.</li>
              )}
              {myItems.map((i) => {
                // Approval notifications (e.g. a leave request awaiting my
                // decision) link straight to the approval screen.
                if (i.kind === "approval") {
                  return (
                    <li
                      key={i.id}
                      className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700">
                              {i.title}
                            </span>
                            <span className="badge bg-indigo-100 text-indigo-700">
                              {kindLabel[i.kind]}
                            </span>
                          </div>
                          {i.body && (
                            <div className="mt-1 text-xs text-slate-500">{i.body}</div>
                          )}
                        </div>
                        <Link
                          href={`/app/${params.slug}/leave/manage`}
                          className="btn-primary px-3 py-1 text-xs"
                        >
                          بررسی و تأیید
                        </Link>
                      </div>
                    </li>
                  );
                }
                // On my own kartabl page, I may edit only items I authored.
                const mine = i.created_by === meId;
                return (
                  <li
                    key={i.id}
                    className="rounded-lg border border-slate-100 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">
                            {i.title}
                          </span>
                          <span className="badge bg-slate-100 text-slate-500">
                            {kindLabel[i.kind]}
                          </span>
                          <span className={`badge ${statusBadge[i.status]}`}>
                            {statusLabel[i.status]}
                          </span>
                          {!mine && i.assigner && (
                            <span className="badge bg-purple-100 text-purple-700">
                              🔒 ارجاع‌شده توسط {i.assigner}
                            </span>
                          )}
                        </div>
                        {i.body && (
                          <div className="mt-1 text-xs text-slate-500">{i.body}</div>
                        )}
                        {mine ? (
                          <div className="mt-2">
                            <ItemActions
                              slug={params.slug}
                              itemId={i.id}
                              title={i.title}
                              body={i.body}
                            />
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-slate-400">
                            این کار به شما ارجاع شده؛ تنها می‌توانید وضعیت پیشرفت را
                            تغییر دهید.
                          </div>
                        )}
                      </div>

                      {/* Status (progress) — allowed for the assignee. */}
                      <form
                        action={setKartablItemStatusAction}
                        className="shrink-0"
                      >
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="itemId" value={i.id} />
                        <select
                          name="status"
                          defaultValue={i.status}
                          className="input w-32 text-xs"
                        >
                          {Object.entries(statusLabel).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <button className="mt-1 w-full text-xs text-brand-600 hover:underline">
                          ثبت وضعیت
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}
