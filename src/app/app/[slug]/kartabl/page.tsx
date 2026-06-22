import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { KartablItemForm } from "./KartablItemForm";
import { setKartablItemStatusAction } from "../actions";

interface Item {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  status: string;
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
};

async function loadKartabls(schema: string, memberId: string) {
  return withTenant(schema, async (tx) => {
    const kartabls = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM kartabls WHERE member_id = ${memberId} ORDER BY created_at
    `;
    const items = await tx<(Item & { kartabl_id: string })[]>`
      SELECT i.id, i.kartabl_id, i.title, i.body, i.kind, i.status
      FROM kartabl_items i
      JOIN kartabls k ON k.id = i.kartabl_id
      WHERE k.member_id = ${memberId}
      ORDER BY i.created_at DESC
    `;
    return { kartabls, items };
  });
}

export default async function KartablPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const { kartabls, items } = await loadKartabls(
    ctx.company.schema,
    ctx.member.memberId
  );

  return (
    <>
      <PageHeader
        title="کارتابل من"
        description="کارها، اسناد و پیام‌های ارجاع‌شده به شما"
      />

      {kartabls.map((k) => {
        const myItems = items.filter((i) => i.kartabl_id === k.id);
        return (
          <div key={k.id} className="card mb-6">
            <h3 className="mb-3 font-semibold text-slate-800">{k.name}</h3>
            <KartablItemForm slug={params.slug} kartablId={k.id} />

            <ul className="mt-4 space-y-2">
              {myItems.length === 0 && (
                <li className="text-sm text-slate-400">موردی ثبت نشده است.</li>
              )}
              {myItems.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        {i.title}
                      </span>
                      <span className="badge bg-slate-100 text-slate-500">
                        {kindLabel[i.kind]}
                      </span>
                      <span className={`badge ${statusBadge[i.status]}`}>
                        {statusLabel[i.status]}
                      </span>
                    </div>
                    {i.body && (
                      <div className="mt-1 text-xs text-slate-500">{i.body}</div>
                    )}
                  </div>
                  <form action={setKartablItemStatusAction} className="shrink-0">
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="itemId" value={i.id} />
                    <select
                      name="status"
                      defaultValue={i.status}
                      className="input w-32 text-xs"
                      // auto-submit handled by the button below for no-JS fallback
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
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
